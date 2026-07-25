import type { DataSource, EntityManager } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { marketLifecycleFromEntity } from '../market/lifecycle.js';
import { resolveClosedExitBidVwap } from '../positions/exit-bid.js';
import {
  computePositionUnrealizedPnl,
  isOpenLikePositionStatus,
} from '../positions/mark.js';
import {
  computeEntryInvestedFromBuyExecutions,
  FILLED_BUY_EXEC_STATUSES,
  type EntryInvestedSnapshot,
} from '../simulation/accounting.js';
import { MarketService } from './market.service.js';

export function watchlistTraderDisplayName(
  entry: WatchlistEntry | undefined,
): string | null {
  if (!entry) return null;
  if (entry.nickname) return entry.nickname;
  return `${entry.traderAddress.slice(0, 10)}…`;
}

export type EnrichedCopiedPosition = CopiedPosition & {
  traderName: string | null;
  traderAddress: string | null;
  marketQuestion: string | null;
  marketUrl: string | null;
  marketIcon: string | null;
  marketEndDate: string | null;
  marketTagSlugs: string[];
  /** Gamma nav category label (e.g. Crypto), when known. */
  marketCategory: string | null;
  /** Market is resolved (payout known). */
  marketResolved: boolean;
  /** Market is closed (no longer accepting new orders). */
  marketClosed: boolean;
  /** Whether the CLOB still accepts orders on this market. */
  marketAcceptingOrders: boolean | null;
  /** Winning outcome token when the market is resolved. */
  marketWinningTokenId: string | null;
  /** Most recent failed SELL execution error while the position remains open. */
  lastCloseError: string | null;
  /** Filled BUY quantity — set for closed positions (quantity is 0 after exit). */
  entryQuantityFilled: number | null;
  /** Total entry cost from BUY fills — set for closed positions. */
  entryInvestedAmount: number | null;
  /** Fill price of the last successful SELL execution (exit price). */
  exitBidVwap: number | null;
};

export class CopiedPositionPresenter {
  constructor(private readonly ds: DataSource) {}

  async enrich(
    positions: CopiedPosition[],
    manager?: EntityManager,
  ): Promise<EnrichedCopiedPosition[]> {
    if (positions.length === 0) return [];

    const m = manager ?? this.ds.manager;
    const watchlistIds = [...new Set(positions.map((p) => p.watchlistId))];
    const conditionIds = [...new Set(positions.map((p) => p.conditionId))];

    const watchlistEntries = await m
      .getRepository(WatchlistEntry)
      .createQueryBuilder('w')
      .where('w.id IN (:...ids)', { ids: watchlistIds })
      .getMany();
    const watchlistById = new Map(watchlistEntries.map((w) => [w.id, w]));

    const marketService = new MarketService(this.ds);
    const marketsByCondition = await marketService.resolveMany(conditionIds);
    const marketEntities = await marketService.loadByConditionIds(conditionIds);
    const lifecycleByCondition = new Map(
      [...marketEntities.entries()].map(([id, m]) => [
        id,
        marketLifecycleFromEntity(m),
      ]),
    );

    const openLikeIds = positions
      .filter((p) => isOpenLikePositionStatus(p.status))
      .map((p) => p.id);
    const lastCloseErrors = await this.resolveLastCloseErrors(openLikeIds, m);

    const closedIds = positions
      .filter((p) => p.status === 'closed')
      .map((p) => p.id);
    const closedEntryInvested =
      await this.resolveClosedEntryInvested(closedIds, m);
    const closedExitBids = await resolveClosedExitBidVwap(this.ds, closedIds, m);

    return positions.map((pos) => {
      const watchlist = watchlistById.get(pos.watchlistId);
      const market = marketsByCondition.get(pos.conditionId);
      const lifecycle = lifecycleByCondition.get(pos.conditionId);
      const unrealizedPnl = isOpenLikePositionStatus(pos.status)
        ? computePositionUnrealizedPnl(pos, lifecycle ?? null)
        : pos.unrealizedPnl;
      const entryInvested = closedEntryInvested.get(pos.id);
      return {
        ...pos,
        unrealizedPnl,
        traderName: watchlistTraderDisplayName(watchlist),
        traderAddress: watchlist?.traderAddress ?? null,
        marketQuestion: market?.question ?? null,
        marketUrl: market?.url ?? null,
        marketIcon: market?.icon ?? null,
        marketEndDate: market?.endDate ?? null,
        marketTagSlugs: market?.tagSlugs ?? [],
        marketCategory: market?.category ?? null,
        marketResolved: market?.resolved ?? false,
        marketClosed: market?.closed ?? false,
        marketAcceptingOrders: lifecycle?.acceptingOrders ?? null,
        marketWinningTokenId: lifecycle?.winningTokenId ?? null,
        lastCloseError: lastCloseErrors.get(pos.id) ?? null,
        entryQuantityFilled: entryInvested?.quantity ?? null,
        entryInvestedAmount: entryInvested?.amount ?? null,
        peakClosurePnlPercent: pos.peakClosurePnlPercent,
        exitBidVwap: closedExitBids.get(pos.id) ?? null,
      };
    });
  }

  /** Entry cost basis for closed positions (quantity is zeroed on full exit). */
  private async resolveClosedEntryInvested(
    positionIds: number[],
    manager: EntityManager,
  ): Promise<Map<number, EntryInvestedSnapshot>> {
    if (positionIds.length === 0) return new Map();

    const executions = await manager
      .getRepository(Execution)
      .createQueryBuilder('e')
      .where('e.copied_position_id IN (:...ids)', { ids: positionIds })
      .andWhere('e.side = :side', { side: 'BUY' })
      .andWhere('e.status IN (:...statuses)', {
        statuses: [...FILLED_BUY_EXEC_STATUSES],
      })
      .getMany();

    const byPosition = new Map<number, Execution[]>();
    for (const ex of executions) {
      const list = byPosition.get(ex.copiedPositionId) ?? [];
      list.push(ex);
      byPosition.set(ex.copiedPositionId, list);
    }

    const result = new Map<number, EntryInvestedSnapshot>();
    for (const id of positionIds) {
      const snapshot = computeEntryInvestedFromBuyExecutions(
        byPosition.get(id) ?? [],
      );
      if (snapshot.quantity > 0 || snapshot.amount > 0) {
        result.set(id, snapshot);
      }
    }
    return result;
  }

  /** Latest failed exit attempt per position (manual, SL, TP, …). */
  private async resolveLastCloseErrors(
    positionIds: number[],
    manager: EntityManager,
  ): Promise<Map<number, string>> {
    if (positionIds.length === 0) return new Map();

    const rows = await manager
      .getRepository(Execution)
      .createQueryBuilder('e')
      .select('e.copied_position_id', 'copiedPositionId')
      .addSelect('e.error', 'error')
      .where('e.copied_position_id IN (:...ids)', { ids: positionIds })
      .andWhere('e.side = :side', { side: 'SELL' })
      .andWhere('e.status = :status', { status: 'failed' })
      .andWhere('e.error IS NOT NULL')
      .orderBy('e.id', 'DESC')
      .getRawMany<{ copiedPositionId: number; error: string }>();

    const map = new Map<number, string>();
    for (const row of rows) {
      const id = Number(row.copiedPositionId);
      if (!map.has(id)) map.set(id, row.error);
    }
    return map;
  }

}
