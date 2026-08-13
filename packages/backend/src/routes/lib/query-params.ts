/** Helpers de parsing de query params partagés entre les routes backend (R6). */

export function parseLimit(value: unknown, fallback: number, max: number): number {
  return Math.max(1, Math.min(Number(value ?? fallback), max));
}

export function parseOffset(value: unknown): number {
  return Math.max(0, Number(value ?? 0));
}

export function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
