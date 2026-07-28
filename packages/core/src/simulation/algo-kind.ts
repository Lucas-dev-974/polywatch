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
    reason === 'WEATHER_PRE_CLOSE' ||
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
