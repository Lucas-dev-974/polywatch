import type { WatchlistEntry } from '../entities/Watchlist.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import {
  type EnrichedCopiedPosition,
  watchlistTraderDisplayName,
} from '../services/copied-position-presenter.js';
import type { SimSnapshotTrader } from '../types/sim-state-snapshot.js';

const TRADERS_LABEL_MAX_LEN = 500;

function traderDisplayLabel(
  nickname: string | null,
  traderAddress: string,
): string {
  if (nickname) return nickname;
  if (traderAddress.length > 12) {
    return `${traderAddress.slice(0, 10)}…`;
  }
  return traderAddress;
}

function emptyTraderStats(): Pick<
  SimSnapshotTrader,
  | 'positionCount'
  | 'openPositionCount'
  | 'closedPositionCount'
  | 'realizedPnl'
  | 'unrealizedPnl'
> {
  return {
    positionCount: 0,
    openPositionCount: 0,
    closedPositionCount: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
  };
}

function rollupKey(watchlistId: number | null, traderAddress: string): string {
  return watchlistId != null ? `w:${watchlistId}` : `a:${traderAddress.toLowerCase()}`;
}

export function buildSimTraderRollup(
  watchlistEntries: WatchlistEntry[],
  enrichedPositions: EnrichedCopiedPosition[],
): { traders: SimSnapshotTrader[]; tradersLabel: string } {
  const simWatchlist = watchlistEntries.filter((e) => e.simEnabled);
  const byKey = new Map<string, SimSnapshotTrader>();

  for (const entry of simWatchlist) {
    const key = rollupKey(entry.id, entry.traderAddress);
    byKey.set(key, {
      watchlistId: entry.id,
      traderAddress: entry.traderAddress,
      nickname: entry.nickname,
      active: entry.active,
      simEnabled: entry.simEnabled,
      inWatchlistSim: true,
      ...emptyTraderStats(),
    });
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
        simEnabled: null,
        inWatchlistSim: false,
        ...emptyTraderStats(),
      };
      byKey.set(key, trader);
    }

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

  const traders = [...byKey.values()].sort((a, b) => {
    const labelA = traderDisplayLabel(a.nickname, a.traderAddress);
    const labelB = traderDisplayLabel(b.nickname, b.traderAddress);
    return labelA.localeCompare(labelB, 'fr');
  });

  const labels = traders.map((t) =>
    traderDisplayLabel(t.nickname, t.traderAddress),
  );
  let tradersLabel = labels.join(', ');
  if (tradersLabel.length > TRADERS_LABEL_MAX_LEN) {
    tradersLabel = `${tradersLabel.slice(0, TRADERS_LABEL_MAX_LEN - 1)}…`;
  }

  return { traders, tradersLabel };
}

/** Re-export for archive service when only watchlist is available. */
export { watchlistTraderDisplayName };
