/**
 * Convert a value that may be a Date, an ISO string, or a numeric timestamp
 * into a Unix timestamp in milliseconds. Returns NaN when the value cannot be
 * interpreted as a date.
 */
export function toTimestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}
