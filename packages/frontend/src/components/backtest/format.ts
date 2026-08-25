import { formatNum, formatTs } from '../../lib/format';

export { formatNum, formatTs };

export function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function fmtUsd(value: number | null | undefined): string {
  return formatNum(value, 2);
}

export function fmtHolding(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(0)} s`;
  const h = ms / 3_600_000;
  if (h >= 1) return `${h.toFixed(1)} h`;
  const m = ms / 60_000;
  return `${m.toFixed(0)} min`;
}

export function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Capital from a completed/selected run — never trust form state for the equity chart. */
export function resolveRunCapital(params: Record<string, unknown> | null | undefined): number {
  const n = Number(params?.capital);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}
