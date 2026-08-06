/** Format a Date (or date-like) as ISO string; nullish → null. */
export function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
