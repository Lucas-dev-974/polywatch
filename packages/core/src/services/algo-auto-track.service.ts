import { type DataSource } from 'typeorm';
import pino from 'pino';
import { AlgoAutoTrackRule } from '../entities/AlgoAutoTrackRule.js';
import { AlgoMarketSelection } from '../entities/AlgoMarketSelection.js';
import { Market } from '../entities/Market.js';
import {
  AUTO_TRACK_SYNC_MIN_INTERVAL_MS,
  discoverBestAutoTrackMarket,
  discoverBestFutureAutoTrackMarket,
  FUTURE_MARKETS_SYNC_MIN_INTERVAL_MS,
  fetchAutoTrackCandidatesForRules,
  isShortRecurringInterval,
  pickBestAutoTrackMarketForSymbol,
  pickBestFutureAutoTrackMarketForSymbol,
  resolveAutoTrackTagSlug,
} from '../polymarket/auto-track-discovery.js';
import type { MarketListItemDto } from '../polymarket/market-list.js';
import { cryptoSymbolsEqual } from '../polymarket/market-list.js';
import { GammaMarketCache } from '../polymarket/gamma-market-cache.js';
import { isActiveAutoTrackSelection } from './algo-market-selection.service.js';
import type { AlgoMarketSelectionService } from './algo-market-selection.service.js';

const log = pino({ name: 'core:algo-auto-track' });

const CACHE_TTL_MS = 5_000;

type ListCache = {
  entries: AlgoAutoTrackRule[];
  expiresAt: number;
};

type SyncCycleResult = {
  disabled: number;
  disabledIds: string[];
  added: number;
  hadWork: boolean;
  rulesNeedingDiscovery: AlgoAutoTrackRule[];
};

export type AutoTrackSyncResult = {
  ran: boolean;
  disabled: number;
  added: number;
};

export class AlgoAutoTrackService {
  private static enabledCache: ListCache | null = null;
  private static lastMarketSyncAt = 0;
  private static lastFutureDiscoveryAt = 0;
  private static futureMarketsCache: {
    liveKeys: string;
    entries: MarketListItemDto[];
  } | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateCache(): void {
    AlgoAutoTrackService.enabledCache = null;
  }

  static invalidateFutureMarketsCache(): void {
    AlgoAutoTrackService.futureMarketsCache = null;
    AlgoAutoTrackService.lastFutureDiscoveryAt = 0;
  }

  private static serializeLiveConditionKeys(
    liveConditionIdsByRule: Map<string, string | null>,
  ): string {
    return [...liveConditionIdsByRule.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, id]) => `${key}=${id ?? ''}`)
      .join('|');
  }

  /** Load all enabled auto-track rules with a 5s in-memory cache. */
  async loadAllEnabled(): Promise<AlgoAutoTrackRule[]> {
    const cached = AlgoAutoTrackService.enabledCache;
    if (cached && Date.now() < cached.expiresAt) {
      return cached.entries;
    }

    const entries = await this.ds.getRepository(AlgoAutoTrackRule).find({
      where: { enabled: true },
      order: { createdAt: 'ASC' },
    });
    AlgoAutoTrackService.enabledCache = {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return entries;
  }

  /** Load all rules (enabled + disabled). */
  async loadAll(): Promise<AlgoAutoTrackRule[]> {
    return this.ds.getRepository(AlgoAutoTrackRule).find({
      order: { createdAt: 'ASC' },
    });
  }

  /** Create a new auto-track rule. Rejects if symbol+interval already exists. */
  async createRule(
    cryptoSymbol: string,
    interval: string,
  ): Promise<AlgoAutoTrackRule> {
    const repo = this.ds.getRepository(AlgoAutoTrackRule);
    const existing = await repo.findOne({
      where: { cryptoSymbol, interval },
    });
    if (existing) {
      throw new Error('DUPLICATE_RULE');
    }
    const rule = repo.create({ cryptoSymbol, interval, enabled: true });
    AlgoAutoTrackService.invalidateCache();
    return repo.save(rule);
  }

  /** Delete a rule by id. */
  async deleteRule(id: number): Promise<void> {
    await this.ds.getRepository(AlgoAutoTrackRule).delete({ id });
    AlgoAutoTrackService.invalidateCache();
  }

  /** Enable or disable a rule. */
  async setEnabled(id: number, enabled: boolean): Promise<void> {
    await this.ds
      .getRepository(AlgoAutoTrackRule)
      .update({ id }, { enabled });
    AlgoAutoTrackService.invalidateCache();
  }

  /**
   * Discover the currently active market for a given symbol + interval.
   * Returns the conditionId of the best matching market, or null if none found.
   */
  async discoverCurrentMarket(
    cryptoSymbol: string,
    interval: string,
  ): Promise<string | null> {
    if (!resolveAutoTrackTagSlug(interval)) {
      log.warn({ interval }, 'unknown interval, no tag slug mapping');
      return null;
    }

    try {
      const selected = await discoverBestAutoTrackMarket(cryptoSymbol, interval);
      if (!selected) {
        log.warn({ cryptoSymbol, interval }, 'no matching active markets found');
        return null;
      }

      log.info(
        {
          conditionId: selected.conditionId,
          cryptoSymbol,
          interval,
          question: selected.question,
        },
        'discovered market for auto-track',
      );

      return selected.conditionId;
    } catch (err) {
      log.error({ err, cryptoSymbol, interval }, 'failed to discover market from Gamma API');
      return null;
    }
  }

  /**
   * Check if there is already an enabled selection whose underlying market
   * is still trackable for the given symbol + interval.
   */
  async hasActiveSelectionForRule(
    cryptoSymbol: string,
    interval: string,
    gammaCache?: GammaMarketCache,
  ): Promise<boolean> {
    const cache = gammaCache ?? new GammaMarketCache();
    return this.ruleHasActiveSelection(cryptoSymbol, interval, cache);
  }

  /** True when at least one enabled auto-track rule lacks an active market selection. */
  async rulesNeedMarketSync(
    selectionService: AlgoMarketSelectionService,
  ): Promise<boolean> {
    const cycle = await this.runAutoTrackSyncCycle({
      selectionService,
      discover: false,
    });
    return cycle.hadWork;
  }

  /**
   * After a market resolves, discover and add a replacement when an enabled
   * auto-track rule covers the selection's symbol + interval.
   */
  async syncAfterMarketResolved(
    selectionService: AlgoMarketSelectionService,
    conditionId: string,
  ): Promise<{ added: boolean }> {
    const selection = await selectionService.findByConditionId(conditionId);
    if (!selection?.cryptoSymbol || !selection.interval) {
      log.debug({ conditionId }, 'resolved market has no auto-track metadata — skip discovery');
      return { added: false };
    }

    const { cryptoSymbol, interval } = selection;
    const rules = await this.loadAllEnabled();
    const ruleActive = rules.some(
      (rule) =>
        cryptoSymbolsEqual(rule.cryptoSymbol, cryptoSymbol) &&
        rule.interval === interval,
    );
    if (!ruleActive) {
      log.debug(
        { conditionId, cryptoSymbol, interval },
        'no enabled auto-track rule for resolved market — skip discovery',
      );
      return { added: false };
    }

    const gammaCache = new GammaMarketCache();
    gammaCache.set(conditionId, null);

    if (await this.ruleHasActiveSelection(cryptoSymbol, interval, gammaCache)) {
      log.debug(
        { conditionId, cryptoSymbol, interval },
        'another active selection already exists after market resolved',
      );
      return { added: false };
    }

    const added = await this.discoverAndAddForRules(
      [{ cryptoSymbol, interval } as AlgoAutoTrackRule],
      selectionService,
    );
    return { added: added > 0 };
  }

  /**
   * For each enabled auto-track rule, resolve the nearest upcoming market
   * (excluding the current live selection when known).
   */
  async discoverFutureMarketsForRules(
    liveConditionIdsByRule: Map<string, string | null>,
  ): Promise<MarketListItemDto[]> {
    const rules = await this.loadAllEnabled();
    if (rules.length === 0) return [];

    const candidatesByInterval = await fetchAutoTrackCandidatesForRules(
      rules,
      liveConditionIdsByRule,
    );
    const futures: MarketListItemDto[] = [];
    const seen = new Set<string>();

    for (const rule of rules) {
      const ruleKey = `${rule.cryptoSymbol}:${rule.interval}`;
      const liveId = liveConditionIdsByRule.get(ruleKey) ?? null;
      const sharedCandidates = candidatesByInterval.get(rule.interval) ?? [];
      let market =
        pickBestFutureAutoTrackMarketForSymbol(
          sharedCandidates,
          rule.cryptoSymbol,
          liveId,
        ) ?? (await discoverBestFutureAutoTrackMarket(
          rule.cryptoSymbol,
          rule.interval,
          liveId,
        ));

      if (!market || seen.has(market.conditionId)) continue;
      seen.add(market.conditionId);
      futures.push(market);
    }

    return futures;
  }

  /**
   * Like {@link discoverFutureMarketsForRules} but throttled (30s by default).
   * Re-runs immediately when the live selection map changes.
   */
  async discoverFutureMarketsForRulesThrottled(
    liveConditionIdsByRule: Map<string, string | null>,
    options?: { force?: boolean },
  ): Promise<MarketListItemDto[]> {
    const liveKeys = AlgoAutoTrackService.serializeLiveConditionKeys(
      liveConditionIdsByRule,
    );
    const now = Date.now();
    const cached = AlgoAutoTrackService.futureMarketsCache;

    if (
      !options?.force &&
      cached &&
      cached.liveKeys === liveKeys &&
      now - AlgoAutoTrackService.lastFutureDiscoveryAt <
        FUTURE_MARKETS_SYNC_MIN_INTERVAL_MS
    ) {
      return cached.entries;
    }

    const entries = await this.discoverFutureMarketsForRules(
      liveConditionIdsByRule,
    );
    AlgoAutoTrackService.lastFutureDiscoveryAt = now;
    AlgoAutoTrackService.futureMarketsCache = { liveKeys, entries };
    return entries;
  }

  /**
   * Disable resolved selections, then discover and add markets for every
   * enabled auto-track rule that is missing an active selection.
   */
  async syncMarketSelectionsForAutoTrack(
    selectionService: AlgoMarketSelectionService,
  ): Promise<{ disabled: number; disabledIds: string[]; added: number }> {
    const cycle = await this.runAutoTrackSyncCycle({
      selectionService,
      discover: true,
    });
    return {
      disabled: cycle.disabled,
      disabledIds: cycle.disabledIds,
      added: cycle.added,
    };
  }

  /**
   * Run {@link syncMarketSelectionsForAutoTrack} when enabled rules exist and
   * at least one rule is missing a trackable market. Throttled globally.
   */
  async syncMarketSelectionsIfNeeded(
    selectionService: AlgoMarketSelectionService,
    options?: { force?: boolean },
  ): Promise<AutoTrackSyncResult> {
    const rules = await this.loadAllEnabled();
    if (rules.length === 0) {
      return { ran: false, disabled: 0, added: 0 };
    }

    const now = Date.now();
    if (
      !options?.force &&
      now - AlgoAutoTrackService.lastMarketSyncAt < AUTO_TRACK_SYNC_MIN_INTERVAL_MS
    ) {
      return { ran: false, disabled: 0, added: 0 };
    }

    const preview = await this.runAutoTrackSyncCycle({
      selectionService,
      discover: false,
    });
    if (!options?.force && !preview.hadWork) {
      return { ran: false, disabled: 0, added: 0 };
    }

    AlgoAutoTrackService.lastMarketSyncAt = now;

    let added = 0;
    if (preview.rulesNeedingDiscovery.length > 0) {
      added = await this.discoverAndAddForRules(
        preview.rulesNeedingDiscovery,
        selectionService,
      );
    }

    return {
      ran: true,
      disabled: preview.disabled,
      added,
    };
  }

  private async runAutoTrackSyncCycle(options: {
    selectionService?: AlgoMarketSelectionService;
    discover: boolean;
  }): Promise<SyncCycleResult> {
    const gammaCache = new GammaMarketCache();
    const disabledIds = options.selectionService
      ? await options.selectionService.disableResolved({ gammaCache })
      : [];
    const disabled = disabledIds.length;
    const rules = await this.loadAllEnabled();

    const rulesNeedingDiscovery: AlgoAutoTrackRule[] = [];
    for (const rule of rules) {
      if (
        !(await this.ruleHasActiveSelection(
          rule.cryptoSymbol,
          rule.interval,
          gammaCache,
        ))
      ) {
        rulesNeedingDiscovery.push(rule);
      }
    }

    const hadWork = disabled > 0 || rulesNeedingDiscovery.length > 0;
    let added = 0;

    if (
      options.discover &&
      options.selectionService &&
      rulesNeedingDiscovery.length > 0
    ) {
      added = await this.discoverAndAddForRules(
        rulesNeedingDiscovery,
        options.selectionService,
      );
    }

    return { disabled, disabledIds, added, hadWork, rulesNeedingDiscovery };
  }

  private async ruleHasActiveSelection(
    cryptoSymbol: string,
    interval: string,
    gammaCache: GammaMarketCache,
  ): Promise<boolean> {
    const selections = await this.ds.getRepository(AlgoMarketSelection).find({
      where: { cryptoSymbol, interval, enabled: true },
    });

    for (const sel of selections) {
      try {
        const marketRow = await this.ds.getRepository(Market).findOne({
          where: { conditionId: sel.conditionId },
        });
        const gamma = await gammaCache.get(sel.conditionId);
        if (
          await isActiveAutoTrackSelection(
            gamma,
            marketRow,
            cryptoSymbol,
            interval,
          )
        ) {
          return true;
        }
      } catch (err) {
        log.warn(
          { err, cryptoSymbol, interval, conditionId: sel.conditionId },
          'Gamma API failed while checking active selection — allowing discovery retry',
        );
      }
    }

    return false;
  }

  private async discoverAndAddForRules(
    rules: AlgoAutoTrackRule[],
    selectionService: AlgoMarketSelectionService,
  ): Promise<number> {
    if (rules.length === 0) return 0;

    const candidatesByInterval = await fetchAutoTrackCandidatesForRules(rules);
    let added = 0;

    for (const rule of rules) {
      const { cryptoSymbol, interval } = rule;
      const requireLive = isShortRecurringInterval(interval);
      const sharedCandidates = candidatesByInterval.get(interval);
      const market: MarketListItemDto | null =
        sharedCandidates && sharedCandidates.length > 0
          ? pickBestAutoTrackMarketForSymbol(sharedCandidates, cryptoSymbol, Date.now(), {
              requireLive,
            })
          : await discoverBestAutoTrackMarket(cryptoSymbol, interval, { requireLive });

      if (!market) {
        log.warn({ cryptoSymbol, interval }, 'no active market found during auto-track sync');
        continue;
      }

      await selectionService.addSelection(market.conditionId, {
        cryptoSymbol,
        interval,
        question: market.question,
        slug: market.slug,
      });
      added++;
      log.info(
        { conditionId: market.conditionId, cryptoSymbol, interval },
        'auto-track sync added market selection',
      );
    }

    return added;
  }
}
