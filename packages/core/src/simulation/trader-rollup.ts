import type { WatchlistEntry } from '../entities/Watchlist.js';
import { buildTraderRollup } from '../snapshot/trader-rollup-shared.js';
import {
  type EnrichedCopiedPosition,
  watchlistTraderDisplayName,
} from '../services/copied-position-presenter.js';
import type { SimSnapshotTrader } from '../types/sim-state-snapshot.js';

export function buildSimTraderRollup(
  watchlistEntries: WatchlistEntry[],
  enrichedPositions: EnrichedCopiedPosition[],
): { traders: SimSnapshotTrader[]; tradersLabel: string } {
  return buildTraderRollup<{
    simEnabled: boolean | null;
    inWatchlistSim: boolean;
  }>(watchlistEntries, enrichedPositions, {
    isEnabled: (e) => e.simEnabled,
    watchlistExtra: (entry) => ({
      simEnabled: entry.simEnabled,
      inWatchlistSim: true,
    }),
    positionExtra: () => ({
      simEnabled: null,
      inWatchlistSim: false,
    }),
  });
}

/** Re-export for archive service when only watchlist is available. */
export { watchlistTraderDisplayName };
