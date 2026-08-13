/** Formatters partagés du frontend (consolidés — R8). */

export function formatCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

export function formatTs(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function formatTsCompact(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNum(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return '∞';
  return value.toFixed(digits);
}

export function formatPollInterval(pollMs: number): string {
  if (!Number.isFinite(pollMs) || pollMs <= 0) return 'intervalle de poll';
  if (pollMs >= 3_600_000) {
    const h = pollMs / 3_600_000;
    return h === 1 ? '1 h' : `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  if (pollMs >= 60_000) {
    const m = pollMs / 60_000;
    return m === 1 ? '1 min' : `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
  }
  const s = Math.max(1, Math.round(pollMs / 1000));
  return s === 1 ? '1 s' : `${s} s`;
}
