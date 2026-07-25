import { In, LessThan, type DataSource } from 'typeorm';
import pino from 'pino';
import {
  isGammaMarketResolved,
  isGammaMarketValidForAutoTrack,
  isShortRecurringInterval,
} from '../polymarket/auto-track-discovery.js';
import { GammaMarketCache } from '../polymarket/gamma-market-cache.js';
import { AlgoMarketSelection } from '../entities/AlgoMarketSelection.js';
import type { Market } from '../entities/Market.js';
import type { GammaMarket } from '../polymarket/market-metadata.js';
import { MarketService } from './market.service.js';

const log = pino({ name: 'core:algo-market-selection' });

const CACHE_TTL_MS = 5_000;

/** Keep disabled rows for 7 days before purging. */
export const DISABLED_SELECTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type ListCache = {
  entries: AlgoMarketSelection[];
  expiresAt: number;
};

export interface AlgoSelectionMeta {
  question?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  slug?: string | null;
}

export interface DisableResolvedOptions {
  gammaCache?: GammaMarketCache;
}

export interface AlgoSelectionStatusCounts {
  enabledSelections: number;
  selectionsWithMarket: number;
  evaluableSelections: number;
}

/** True when a persisted market row can be evaluated by the algo runner. */
export function isTradableAlgoMarket(market: Market, now: Date = new Date()): boolean {
  if (!market.tokenIdYes) return false;
  if (market.resolved || market.closed) return false;
  if (market.acceptingOrders === false) return false;
  if (market.endDate && market.endDate < now) return false;
  return true;
}

export class AlgoMarketSelectionService {
  private static enabledCache: ListCache | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly marketService?: MarketService,
  ) {}

  static invalidateCache(): void {
    AlgoMarketSelectionService.enabledCache = null;
  }

  async loadAllEnabled(): Promise<AlgoMarketSelection[]> {
    const cached = AlgoMarketSelectionService.enabledCache;
    if (cached && Date.now() < cached.expiresAt) {
      return cached.entries;
    }

    const entries = await this.ds.getRepository(AlgoMarketSelection).find({
      where: { enabled: true },
      order: { createdAt: 'ASC' },
    });
    AlgoMarketSelectionService.enabledCache = {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return entries;
  }

  async loadAll(): Promise<AlgoMarketSelection[]> {
    return this.ds.getRepository(AlgoMarketSelection).find({
      order: { createdAt: 'ASC' },
    });
  }

  async findByConditionId(
    conditionId: string,
  ): Promise<AlgoMarketSelection | null> {
    return this.ds
      .getRepository(AlgoMarketSelection)
      .findOne({ where: { conditionId } });
  }

  /** Fetch Gamma metadata and persist a tradable row in `markets`. */
  async ensureMarketPersisted(conditionId: string): Promise<Market | null> {
    if (!this.marketService) {
      log.warn({ conditionId }, 'ensureMarketPersisted skipped — no MarketService');
      return null;
    }

    const market = await this.marketService.ensureTradableMarket(conditionId);
    if (!market) {
      log.warn({ conditionId }, 'failed to ensure tradable market for algo selection');
    }
    return market;
  }

  /** Persist `markets` rows for every enabled selection (boot / recovery). */
  async ensureMarketsForEnabledSelections(): Promise<number> {
    const enabled = await this.loadAllEnabled();
    let persisted = 0;
    for (const sel of enabled) {
      if (await this.ensureMarketPersisted(sel.conditionId)) {
        persisted += 1;
      }
    }
    if (enabled.length > 0) {
      log.info(
        { enabled: enabled.length, persisted },
        'ensured market rows for enabled algo selections',
      );
    }
    return persisted;
  }

  /**
   * Upsert an algo market selection by conditionId. Re-enables existing rows
   * and ensures the underlying market metadata is persisted.
   */
  async addSelection(
    conditionId: string,
    meta: AlgoSelectionMeta,
  ): Promise<AlgoMarketSelection> {
    const repo = this.ds.getRepository(AlgoMarketSelection);
    const existing = await repo.findOne({ where: { conditionId } });
    let saved: AlgoMarketSelection;

    if (existing) {
      if (meta.question !== undefined) existing.question = meta.question ?? null;
      if (meta.cryptoSymbol !== undefined) {
        existing.cryptoSymbol = meta.cryptoSymbol ?? null;
      }
      if (meta.interval !== undefined) existing.interval = meta.interval ?? null;
      if (meta.slug !== undefined) existing.slug = meta.slug ?? null;
      existing.enabled = true;
      saved = await repo.save(existing);
    } else {
      saved = await repo.save(
        repo.create({
          conditionId,
          question: meta.question ?? null,
          cryptoSymbol: meta.cryptoSymbol ?? null,
          interval: meta.interval ?? null,
          slug: meta.slug ?? null,
          enabled: true,
        }),
      );
    }

    AlgoMarketSelectionService.invalidateCache();
    await this.ensureMarketPersisted(conditionId);
    return saved;
  }

  async removeSelection(conditionId: string): Promise<void> {
    await this.ds.getRepository(AlgoMarketSelection).delete({ conditionId });
    AlgoMarketSelectionService.invalidateCache();
  }

  async setEnabled(conditionId: string, enabled: boolean): Promise<void> {
    await this.ds
      .getRepository(AlgoMarketSelection)
      .update({ conditionId }, { enabled });
    AlgoMarketSelectionService.invalidateCache();
    if (enabled) {
      await this.ensureMarketPersisted(conditionId);
    }
  }

  async disableResolved(options?: DisableResolvedOptions): Promise<string[]> {
    const enabledSelections = await this.ds
      .getRepository(AlgoMarketSelection)
      .find({ where: { enabled: true } });

    if (enabledSelections.length === 0) return [];

    const gammaCache = options?.gammaCache ?? new GammaMarketCache();
    const now = Date.now();
    const toDisable: string[] = [];

    for (const sel of enabledSelections) {
      try {
        if (await this.shouldDisableSelection(sel, gammaCache, now)) {
          toDisable.push(sel.conditionId);
        }
      } catch (err) {
        log.warn(
          { err, conditionId: sel.conditionId },
          'disableResolved: failed to evaluate selection',
        );
      }
    }

    if (toDisable.length === 0) return [];

    await this.ds
      .getRepository(AlgoMarketSelection)
      .update({ conditionId: In(toDisable) }, { enabled: false });
    AlgoMarketSelectionService.invalidateCache();

    return toDisable;
  }

  /** Count enabled selections and how many have tradable `markets` rows. */
  async getStatusCounts(): Promise<AlgoSelectionStatusCounts> {
    const enabled = await this.loadAllEnabled();
    if (enabled.length === 0) {
      return { enabledSelections: 0, selectionsWithMarket: 0, evaluableSelections: 0 };
    }

    const now = new Date();
    let selectionsWithMarket = 0;
    let evaluableSelections = 0;

    if (!this.marketService) {
      return {
        enabledSelections: enabled.length,
        selectionsWithMarket: 0,
        evaluableSelections: 0,
      };
    }

    const markets = await this.marketService.loadByConditionIds(
      enabled.map((s) => s.conditionId),
    );

    for (const sel of enabled) {
      const market = markets.get(sel.conditionId);
      if (!market?.tokenIdYes) continue;
      selectionsWithMarket += 1;
      if (isTradableAlgoMarket(market, now)) {
        evaluableSelections += 1;
      }
    }

    return {
      enabledSelections: enabled.length,
      selectionsWithMarket,
      evaluableSelections,
    };
  }

  async purgeDisabled(
    olderThanMs: number = DISABLED_SELECTION_RETENTION_MS,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await this.ds.getRepository(AlgoMarketSelection).delete({
      enabled: false,
      updatedAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }

  private async shouldDisableSelection(
    sel: AlgoMarketSelection,
    gammaCache: GammaMarketCache,
    now: number,
  ): Promise<boolean> {
    const gamma = await gammaCache.get(sel.conditionId);
    if (!gamma || isGammaMarketResolved(gamma, now)) {
      return true;
    }

    if (
      sel.interval &&
      sel.cryptoSymbol &&
      isShortRecurringInterval(sel.interval) &&
      !isGammaMarketValidForAutoTrack(gamma, sel.cryptoSymbol, { requireLive: true })
    ) {
      return true;
    }

    if (!this.marketService) {
      return false;
    }

    const market = await this.marketService.ensureTradableMarket(sel.conditionId);
    return market == null;
  }
}

/** True when a Gamma market is valid for auto-track and has a tradable DB row. */
export async function isActiveAutoTrackSelection(
  gamma: GammaMarket | null,
  marketRow: Market | null,
  cryptoSymbol: string,
  interval: string,
): Promise<boolean> {
  if (!gamma || !marketRow?.tokenIdYes) {
    return false;
  }
  const requireLive = isShortRecurringInterval(interval);
  return isGammaMarketValidForAutoTrack(gamma, cryptoSymbol, { requireLive });
}
