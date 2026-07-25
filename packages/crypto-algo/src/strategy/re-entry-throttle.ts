/**
 * Pure re-entry throttle helpers used by StrategyRunner.
 * Exported for unit tests.
 */

export interface ReEntryState {
  windowStart: number;
  windowMs: number;
  count: number;
}

export function buildReEntryKey(conditionId: string, outcome: string): string {
  return `${conditionId}:${outcome}`;
}

/** True when an in-window entry should be suppressed before calling onSignal. */
export function shouldSuppressReEntry(
  state: ReEntryState | undefined,
  nowMs: number,
  maxEntries: number,
): boolean {
  if (!state) return false;
  if (nowMs - state.windowStart >= state.windowMs) return false;
  return state.count >= maxEntries;
}

/** Normalize position/signal outcome labels to re-entry key format. */
export function normalizeReEntryOutcome(outcome: string): 'YES' | 'NO' | null {
  const v = outcome.trim().toLowerCase();
  if (v === 'yes' || v === 'up') return 'YES';
  if (v === 'no' || v === 'down') return 'NO';
  return null;
}

/** Increment re-entry count after a confirmed BUY fill (not on enqueue). */
export function recordReEntrySuccess(
  map: Map<string, ReEntryState>,
  key: string,
  nowMs: number,
  windowMs: number,
): void {
  const state = map.get(key);
  const inWindow =
    state != null && nowMs - state.windowStart < state.windowMs;

  if (inWindow && state) {
    state.count += 1;
    return;
  }

  map.set(key, {
    windowStart: nowMs,
    windowMs,
    count: 1,
  });
}

/** Remove expired re-entry windows. */
export function cleanupReentryMap(
  map: Map<string, ReEntryState>,
  nowMs: number,
): number {
  let removed = 0;
  for (const [key, state] of Array.from(map.entries())) {
    if (nowMs - state.windowStart > state.windowMs) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}
