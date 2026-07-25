/**
 * trader_snapshots.size is stored as float4 (real); for large positions the
 * round-trip error exceeds 1e-6 absolute, so comparisons use relative tolerance.
 */
export const SIZE_REL_TOLERANCE = 1e-6;
export const SIZE_ABS_TOLERANCE = 1e-9;

export function sizeDirection(prev: number, next: number): -1 | 0 | 1 {
  const tol = Math.max(
    SIZE_ABS_TOLERANCE,
    Math.max(Math.abs(prev), Math.abs(next)) * SIZE_REL_TOLERANCE,
  );
  if (next - prev > tol) return 1;
  if (prev - next > tol) return -1;
  return 0;
}
