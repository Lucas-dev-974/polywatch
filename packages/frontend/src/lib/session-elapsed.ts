/** Elapsed milliseconds from session start until end (or `now` if still active). */
export function elapsedMsSince(
  startedAt: string,
  endedAt: string | null | undefined,
  now: number,
): number {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return 0;
  const endMs = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(endMs)) return Math.max(0, now - startMs);
  return Math.max(0, endMs - startMs);
}
