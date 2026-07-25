import type { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';

/** Minimum interval users can configure (seconds). */
export const MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS = 60;

export function parseSnapshotCreatedAtMs(
  value: Date | string | null | undefined,
): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isAutoSnapshotDue(
  intervalSec: number,
  lastAutoCreatedAtMs: number | null,
  nowMs: number,
  minIntervalSec = MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
): boolean {
  if (!Number.isFinite(intervalSec) || intervalSec < minIntervalSec) {
    return false;
  }
  const intervalMs = intervalSec * 1000;
  if (lastAutoCreatedAtMs == null) return true;
  if (!Number.isFinite(lastAutoCreatedAtMs)) return false;
  return nowMs - lastAutoCreatedAtMs >= intervalMs;
}

/**
 * Interval check based on an elapsed age (seconds) computed by the database
 * clock. Prefer this over {@link isAutoSnapshotDue}: comparing JS `Date`
 * values against a `timestamp without time zone` column is unsafe because the
 * driver reinterprets the stored UTC value in the local timezone.
 */
export function isAutoSnapshotDueByAge(
  intervalSec: number,
  lastAgeSeconds: number | null,
  minIntervalSec = MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
): boolean {
  if (!Number.isFinite(intervalSec) || intervalSec < minIntervalSec) {
    return false;
  }
  if (lastAgeSeconds == null) return true;
  if (!Number.isFinite(lastAgeSeconds)) return false;
  return lastAgeSeconds >= intervalSec;
}

export function latestAutoSnapshotCreatedAtMs(
  rows: Pick<SimulationStateSnapshot, 'createdAt'>[],
): number | null {
  if (rows.length === 0) return null;
  return parseSnapshotCreatedAtMs(rows[0].createdAt);
}
