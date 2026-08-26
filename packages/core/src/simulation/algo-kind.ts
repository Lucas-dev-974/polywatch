export type SimAlgoKind = 'crypto' | 'weather' | 'copy';

/**
 * Derive the algo perimeter from a CopiedPosition/Execution/PositionReservation reason.
 * Handles open, increase, and exit reasons.
 *
 * Note: for `finalize` cash adjustment, use the CopiedPosition.reason (reason of
 * opening, preserved after close), NOT the Execution.reason (which is the exit
 * reason and can be shared across algos: SL, TP, TRAILING, ...).
 */
export function algoKindFromReason(
  reason: string | null | undefined,
): SimAlgoKind {
  if (
    reason === 'WEATHER_OPEN' ||
    reason === 'WEATHER_FORECAST_CHANGE' ||
    reason === 'WEATHER_BUCKET_EXIT'
  )
    return 'weather';
  if (
    reason === 'COPY_OPEN' ||
    reason === 'COPY_INCREASE' ||
    reason === 'COPY_CLOSE' ||
    reason === 'COPY_DECREASE'
  )
    return 'copy';
  return 'crypto'; // ALGO_OPEN, ALGO_INCREASE, SL, TP, TRAILING, PRE_CLOSE_*, MANUAL, KILL_SWITCH, REDEMPTION
}

/**
 * Resolve algoKind from a CopiedPosition's opening reason.
 * This is the SAFE way to determine which algo a position belongs to,
 * because exit reasons (SL/TP/TRAILING) are shared across algos and
 * algoKindFromReason('SL') would incorrectly return 'crypto'.
 *
 * Use this in the worker when loading algo-specific config for close signals.
 */
export function getAlgoKindForPosition(
  position: { reason: string | null | undefined } | null | undefined,
): SimAlgoKind {
  if (!position?.reason) return 'crypto';
  return algoKindFromReason(position.reason);
}

/**
 * List of CopiedPosition opening reasons that belong to a given algoKind.
 * Use this to scope SQL queries (e.g. daily PnL for kill-switch) to one algo.
 */
export function openingReasonsForAlgoKind(algoKind: SimAlgoKind): string[] {
  switch (algoKind) {
    case 'copy':
      return ['COPY_OPEN', 'COPY_INCREASE'];
    case 'weather':
      return ['WEATHER_OPEN', 'WEATHER_FORECAST_CHANGE'];
    case 'crypto':
    default:
      return ['ALGO_OPEN', 'ALGO_INCREASE'];
  }
}

/**
 * SQL LIKE pattern for filtering CopiedPosition/Execution by algoKind.
 * Covers all reasons (open, increase, close, exit) for that algo.
 */
export function algoKindLikePattern(algoKind: SimAlgoKind): string {
  switch (algoKind) {
    case 'copy':
      return 'COPY_%';
    case 'weather':
      return 'WEATHER_%';
    case 'crypto':
    default:
      return 'ALGO_%';
  }
}
