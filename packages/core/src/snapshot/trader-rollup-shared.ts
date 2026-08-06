/**
 * Shared pure helpers for sim/real trader rollup (C1).
 * Mode-specific enabled / inWatchlist fields stay in thin wrappers.
 */
import type { WatchlistEntry } from '../entities/Watchlist.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';

export const TRADERS_LABEL_MAX_LEN = 500;

export type TraderRollupStats = {
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
};

export type TraderRollupBase = TraderRollupStats & {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  active: boolean | null;
};

export function traderDisplayLabel(
  nickname: string | null,
  traderAddress: string,
): string {
  if (nickname) return nickname;
  if (traderAddress.length > 12) {
    return `${traderAddress.slice(0, 10)}…`;
  }
  return traderAddress;
}

export function emptyTraderStats(): TraderRollupStats {
  return {
    positionCount: 0,
    openPositionCount: 0,
    closedPositionCount: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
  };
}

export function rollupKey(
  watchlistId: number | null,
  traderAddress: string,
): string {
  return watchlistId != null
    ? `w:${watchlistId}`
    : `a:${traderAddress.toLowerCase()}`;
}

export function formatTradersLabel(
  traders: Array<{ nickname: string | null; traderAddress: string }>,
): string {
  const labels = traders.map((t) =>
    traderDisplayLabel(t.nickname, t.traderAddress),
  );
  let tradersLabel = labels.join(', ');
  if (tradersLabel.length > TRADERS_LABEL_MAX_LEN) {
    tradersLabel = `${tradersLabel.slice(0, TRADERS_LABEL_MAX_LEN - 1)}…`;
  }
  return tradersLabel;
}

export function accumulatePositionIntoTrader(
  trader: TraderRollupStats,
  pos: EnrichedCopiedPosition,
): void {
  trader.positionCount += 1;
  if (isOpenLikePositionStatus(pos.status)) {
    trader.openPositionCount += 1;
    trader.unrealizedPnl += pos.unrealizedPnl ?? 0;
  }
  if (pos.status === 'closed') {
    trader.closedPositionCount += 1;
    trader.realizedPnl += pos.realizedPnl ?? 0;
  }
}

export function buildTraderRollup<TExtra extends Record<string, unknown>>(
  watchlistEntries: WatchlistEntry[],
  enrichedPositions: EnrichedCopiedPosition[],
  opts: {
    isEnabled: (entry: WatchlistEntry) => boolean;
    watchlistExtra: (entry: WatchlistEntry) => TExtra;
    positionExtra: () => TExtra;
  },
): { traders: Array<TraderRollupBase & TExtra>; tradersLabel: string } {
  type Row = TraderRollupBase & TExtra;
  const enabled = watchlistEntries.filter(opts.isEnabled);
  const byKey = new Map<string, Row>();

  for (const entry of enabled) {
    const key = rollupKey(entry.id, entry.traderAddress);
    byKey.set(key, {
      watchlistId: entry.id,
      traderAddress: entry.traderAddress,
      nickname: entry.nickname,
      active: entry.active,
      ...opts.watchlistExtra(entry),
      ...emptyTraderStats(),
    } as Row);
  }

  for (const pos of enrichedPositions) {
    const address = pos.traderAddress ?? '';
    const key = rollupKey(pos.watchlistId, address || `id:${pos.watchlistId}`);
    let trader = byKey.get(key);

    if (!trader) {
      trader = {
        watchlistId: pos.watchlistId,
        traderAddress: address,
        nickname: pos.traderName,
        active: null,
        ...opts.positionExtra(),
        ...emptyTraderStats(),
      } as Row;
      byKey.set(key, trader);
    }

    accumulatePositionIntoTrader(trader, pos);
  }

  const traders = [...byKey.values()].sort((a, b) => {
    const labelA = traderDisplayLabel(a.nickname, a.traderAddress);
    const labelB = traderDisplayLabel(b.nickname, b.traderAddress);
    return labelA.localeCompare(labelB, 'fr');
  });

  return { traders, tradersLabel: formatTradersLabel(traders) };
}
