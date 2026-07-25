/** Default interval between MoveDetector poll cycles. */
export const DEFAULT_MOVE_DETECTOR_INTERVAL_MS = 2_000;

/** Minimum allowed poll interval (ms). */
export const MIN_MOVE_DETECTOR_INTERVAL_MS = 500;

/** Maximum allowed poll interval (ms). */
export const MAX_MOVE_DETECTOR_INTERVAL_MS = 120_000;

export interface WatchlistPollFlags {
  active: boolean;
  simEnabled: boolean;
  realEnabled: boolean;
}

export function countActiveWatchlistTraders(
  entries: WatchlistPollFlags[],
): number {
  return entries.filter(
    (e) => e.active || e.simEnabled || e.realEnabled,
  ).length;
}

/** One Data API `/positions` request per active trader per poll cycle. */
export function computeMoveDetectorRequestsPerMinute(
  activeTraderCount: number,
  intervalMs: number,
): number {
  if (intervalMs <= 0 || activeTraderCount <= 0) return 0;
  return activeTraderCount * (60_000 / intervalMs);
}
