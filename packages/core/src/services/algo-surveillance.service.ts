import type { DataSource } from 'typeorm';
import pino from 'pino';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import { Market } from '../entities/Market.js';
import {
  captureAlgoPositionsForCondition,
  enrichAlgoSurveillancePositions,
  loadAlgoPositionsByConditionIds,
  parseFrozenAlgoPositions,
} from './algo-surveillance-positions.js';
import { MarketService } from './market.service.js';
import {
  isRedemptionOutcomePrices,
  REDEMPTION_WIN_THRESHOLD,
  type AlgoSurveillancePositionSummary,
  type AlgoSurveillanceSnapshotDto,
  type OutcomePrices,
  type UpsertSurveillanceMetaInput,
} from './algo-surveillance.types.js';

export {
  OPEN_SNAPSHOT_DELAY_MS,
  CLOSE_SNAPSHOT_DELAY_MS,
  SURVEILLANCE_CLOSE_TTL_MS,
  REDEMPTION_WIN_THRESHOLD,
  isRedemptionOutcomePrices,
  type AlgoSurveillancePositionSummary,
  type AlgoSurveillanceSnapshotDto,
  type OutcomePrices,
  type UpsertSurveillanceMetaInput,
} from './algo-surveillance.types.js';

import {
  parseUpDownPricesFromGamma,
  resolveUpDownWinnerLabel,
  resolveUpDownWinnerFromMarket,
  redemptionPricesForWinner,
  tryRedemptionPricesFromGamma,
  snapshotHasRedemptionClose,
  type UpDownWinner,
} from './algo-surveillance-helpers.js';

export {
  parseUpDownPricesFromGamma,
  resolveUpDownWinnerLabel,
  resolveUpDownWinnerFromMarket,
  redemptionPricesForWinner,
  tryRedemptionPricesFromGamma,
  snapshotHasRedemptionClose,
  parseIntervalToMs,
  resolveSurveillanceEndAt,
  type UpDownWinner,
} from './algo-surveillance-helpers.js';

const log = pino({ name: 'algo-surveillance' });

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function toDto(
  row: AlgoSurveillanceSnapshot,
  positions: AlgoSurveillancePositionSummary[] = [],
  positionsFrozen = false,
): AlgoSurveillanceSnapshotDto {
  return {
    id: row.id,
    conditionId: row.conditionId,
    question: row.question,
    cryptoSymbol: row.cryptoSymbol,
    interval: row.interval,
    slug: row.slug,
    marketStartAt: toIso(row.marketStartAt),
    marketEndAt: toIso(row.marketEndAt),
    openUpPrice: row.openUpPrice,
    openDownPrice: row.openDownPrice,
    openCapturedAt: toIso(row.openCapturedAt),
    closeUpPrice: row.closeUpPrice,
    closeDownPrice: row.closeDownPrice,
    closeCapturedAt: toIso(row.closeCapturedAt),
    winningOutcome: row.winningOutcome,
    unresolvedAt: toIso(row.unresolvedAt),
    positions,
    positionsFrozen,
  };
}

async function resolvePositionsForRow(
  ds: DataSource,
  row: AlgoSurveillanceSnapshot,
  liveByCondition: Map<string, AlgoSurveillancePositionSummary[]>,
): Promise<{ positions: AlgoSurveillancePositionSummary[]; frozen: boolean }> {
  if (row.closeCapturedAt) {
    const frozen = parseFrozenAlgoPositions(row.positionsJson);
    if (frozen) {
      return {
        positions: await enrichAlgoSurveillancePositions(ds, frozen),
        frozen: true,
      };
    }
  }
  return {
    positions: liveByCondition.get(row.conditionId) ?? [],
    frozen: false,
  };
}

export class AlgoSurveillanceService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(AlgoSurveillanceSnapshot);
  }

  async upsertMeta(input: UpsertSurveillanceMetaInput): Promise<AlgoSurveillanceSnapshot> {
    const repo = this.repo();
    let row = await repo.findOne({ where: { conditionId: input.conditionId } });

    if (!row) {
      row = repo.create({ conditionId: input.conditionId });
    }

    if (input.question !== undefined) row.question = input.question;
    if (input.cryptoSymbol !== undefined) row.cryptoSymbol = input.cryptoSymbol;
    if (input.interval !== undefined) row.interval = input.interval;
    if (input.slug !== undefined) row.slug = input.slug;
    if (input.marketStartAt !== undefined) {
      row.marketStartAt = parseDate(input.marketStartAt);
    }
    if (input.marketEndAt !== undefined) {
      row.marketEndAt = parseDate(input.marketEndAt);
    }

    return repo.save(row);
  }

  async recordOpenSnapshot(conditionId: string, prices: OutcomePrices): Promise<boolean> {
    const row = await this.repo().findOne({ where: { conditionId } });
    if (!row || row.openCapturedAt) return false;
    if (prices.upPrice == null && prices.downPrice == null) return false;

    row.openUpPrice = prices.upPrice;
    row.openDownPrice = prices.downPrice;
    row.openCapturedAt = new Date();
    await this.repo().save(row);
    return true;
  }

  private async freezePositionsOnRow(row: AlgoSurveillanceSnapshot): Promise<void> {
    const positions = await captureAlgoPositionsForCondition(this.ds, row.conditionId);
    row.positionsJson = JSON.stringify(positions);
    row.positionsCapturedAt = new Date();
  }

  async recordCloseSnapshot(
    conditionId: string,
    prices: OutcomePrices,
    winningOutcome?: string | null,
  ): Promise<boolean> {
    const row = await this.repo().findOne({ where: { conditionId } });
    if (!row) return false;
    if (prices.upPrice == null && prices.downPrice == null) return false;
    if (!isRedemptionOutcomePrices(prices)) return false;

    if (
      row.closeCapturedAt != null &&
      isRedemptionOutcomePrices({
        upPrice: row.closeUpPrice,
        downPrice: row.closeDownPrice,
      })
    ) {
      return false;
    }

    row.closeUpPrice = prices.upPrice;
    row.closeDownPrice = prices.downPrice;
    row.closeCapturedAt = new Date();
    row.unresolvedAt = null;
    if (winningOutcome) row.winningOutcome = winningOutcome;
    await this.freezePositionsOnRow(row);
    await this.repo().save(row);
    return true;
  }

  /**
   * Attempt to close a pending snapshot using the on-chain resolved market record.
   * This is a fallback when Gamma still reports stale non-redemption prices.
   */
  async resolveFallbackCloseFromMarket(conditionId: string): Promise<boolean> {
    const row = await this.repo().findOne({ where: { conditionId } });
    if (!row || row.closeCapturedAt) return false;

    const marketService = new MarketService(this.ds);
    try {
      await marketService.fetchAndPersist(conditionId);
    } catch (err) {
      log.warn({ err, conditionId }, 'fetchAndPersist failed during fallback close');
    }

    const market = await this.ds.getRepository(Market).findOne({ where: { conditionId } });
    const winner = resolveUpDownWinnerFromMarket(market);
    if (!winner) return false;

    const prices = redemptionPricesForWinner(winner);
    row.closeUpPrice = prices.upPrice;
    row.closeDownPrice = prices.downPrice;
    row.closeCapturedAt = new Date();
    row.winningOutcome = winner;
    row.unresolvedAt = null;
    await this.freezePositionsOnRow(row);
    await this.repo().save(row);
    return true;
  }

  /** Clears a non-redemption close snapshot so it can be recaptured. */
  async clearCloseSnapshot(conditionId: string): Promise<boolean> {
    const row = await this.repo().findOne({ where: { conditionId } });
    if (!row || !row.closeCapturedAt) return false;
    if (
      isRedemptionOutcomePrices({
        upPrice: row.closeUpPrice,
        downPrice: row.closeDownPrice,
      })
    ) {
      return false;
    }

    row.closeUpPrice = null;
    row.closeDownPrice = null;
    row.closeCapturedAt = null;
    row.winningOutcome = null;
    row.unresolvedAt = null;
    row.positionsJson = null;
    row.positionsCapturedAt = null;
    await this.repo().save(row);
    return true;
  }

  async listHistory(
    limit = 50,
    offset = 0,
  ): Promise<{ items: AlgoSurveillanceSnapshotDto[]; total: number }> {
    const repo = this.repo();
    const qb = repo
      .createQueryBuilder('s')
      .where('s.open_captured_at IS NOT NULL OR s.close_captured_at IS NOT NULL')
      .orderBy('s.market_start_at', 'DESC')
      .addOrderBy('s.id', 'DESC');

    const [rows, total] = await qb
      .take(Math.max(1, Math.min(limit, 200)))
      .skip(Math.max(0, offset))
      .getManyAndCount();

    const positionsByCondition = await loadAlgoPositionsByConditionIds(
      this.ds,
      rows.map((row) => row.conditionId),
    );

    const items = await Promise.all(
      rows.map(async (row) => {
        const resolved = await resolvePositionsForRow(
          this.ds,
          row,
          positionsByCondition,
        );
        return toDto(row, resolved.positions, resolved.frozen);
      }),
    );

    return { items, total };
  }

  /**
   * Returns a surveillance snapshot. Positions are omitted by default because
   * crypto-algo's recorder calls this on every market refresh.
   */
  async getByConditionId(
    conditionId: string,
    options?: { includePositions?: boolean },
  ): Promise<AlgoSurveillanceSnapshotDto | null> {
    const row = await this.repo().findOne({ where: { conditionId } });
    if (!row) return null;

    if (!options?.includePositions) {
      return toDto(row);
    }

    const positionsByCondition = await loadAlgoPositionsByConditionIds(this.ds, [
      conditionId,
    ]);
    const resolved = await resolvePositionsForRow(
      this.ds,
      row,
      positionsByCondition,
    );
    return toDto(row, resolved.positions, resolved.frozen);
  }

  /**
   * Returns snapshots for markets that are currently live:
   * open snapshot captured, close not yet captured, not unresolved,
   * and both market start/end dates are present.
   */
  async findLiveMarkets(): Promise<AlgoSurveillanceSnapshotDto[]> {
    const rows = await this.repo()
      .createQueryBuilder('s')
      .where('s.open_captured_at IS NOT NULL')
      .andWhere('s.close_captured_at IS NULL')
      .andWhere('s.unresolved_at IS NULL')
      .andWhere('s.market_start_at IS NOT NULL')
      .andWhere('s.market_end_at IS NOT NULL')
      .getMany();
    return rows.map((row) => toDto(row));
  }

  async findNonRedemptionCloseSnapshots(limit = 50): Promise<AlgoSurveillanceSnapshotDto[]> {
    const rows = await this.repo()
      .createQueryBuilder('s')
      .where('s.close_captured_at IS NOT NULL')
      .andWhere(
        '(s.close_up_price IS NULL OR s.close_up_price < :winThreshold)',
        { winThreshold: REDEMPTION_WIN_THRESHOLD },
      )
      .andWhere(
        '(s.close_down_price IS NULL OR s.close_down_price < :winThreshold)',
        { winThreshold: REDEMPTION_WIN_THRESHOLD },
      )
      .andWhere('s.unresolved_at IS NULL')
      .orderBy('s.market_end_at', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(Math.max(1, Math.min(limit, 200)))
      .getMany();

    return rows.map((row) => toDto(row));
  }

  /**
   * Returns snapshots that have no redemption close and whose market end is past
   * the supplied TTL. Used by the surveillance janitor.
   */
  async findPendingSnapshotsPastDeadline(
    ttlAfterEndMs: number,
    limit = 50,
  ): Promise<AlgoSurveillanceSnapshotDto[]> {
    const deadline = new Date(Date.now() - ttlAfterEndMs);
    const rows = await this.repo()
      .createQueryBuilder('s')
      .where('s.close_captured_at IS NULL')
      .andWhere('s.unresolved_at IS NULL')
      .andWhere('s.market_end_at IS NOT NULL')
      .andWhere('s.market_end_at <= :deadline', { deadline })
      .orderBy('s.market_end_at', 'ASC')
      .take(Math.max(1, Math.min(limit, 200)))
      .getMany();

    return rows.map((row) => toDto(row));
  }

  /**
   * Mark snapshots whose close never arrived as unresolved. Before marking, try
   * to resolve them from the local `markets` table.
   */
  async markUnresolvedIfDeadlinePassed(ttlAfterEndMs: number): Promise<number> {
    const pending = await this.findPendingSnapshotsPastDeadline(ttlAfterEndMs);
    let marked = 0;

    for (const row of pending) {
      try {
        const resolvedByMarket = await this.resolveFallbackCloseFromMarket(
          row.conditionId,
        );
        if (resolvedByMarket) {
          continue;
        }
      } catch (err) {
        log.warn({ err, conditionId: row.conditionId }, 'fallback market resolution failed');
      }

      await this.repo()
        .createQueryBuilder()
        .update(AlgoSurveillanceSnapshot)
        .set({ unresolvedAt: new Date() })
        .where('id = :id', { id: row.id })
        .execute();
      marked++;
    }

    return marked;
  }
}
