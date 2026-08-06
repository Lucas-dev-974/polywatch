import type { WatchlistEntry } from '../entities/Watchlist.js';
import { buildTraderRollup } from '../snapshot/trader-rollup-shared.js';
import {
  type EnrichedCopiedPosition,
  watchlistTraderDisplayName,
} from '../services/copied-position-presenter.js';
import type { RealSnapshotTrader } from '../types/real-state-snapshot.js';

export function buildRealTraderRollup(
  watchlistEntries: WatchlistEntry[],
  enrichedPositions: EnrichedCopiedPosition[],
): { traders: RealSnapshotTrader[]; tradersLabel: string } {
  return buildTraderRollup<{
    realEnabled: boolean | null;
    inWatchlistReal: boolean;
  }>(watchlistEntries, enrichedPositions, {
    isEnabled: (e) => e.realEnabled,
    watchlistExtra: (entry) => ({
      realEnabled: entry.realEnabled,
      inWatchlistReal: true,
    }),
    positionExtra: () => ({
      realEnabled: null,
      inWatchlistReal: false,
    }),
  });
}

export { watchlistTraderDisplayName };
