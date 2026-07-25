const SHORT_DATETIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

export function formatShortDateTime(
  iso: string | null | undefined,
): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', SHORT_DATETIME);
}

export function formatTimestampMs(timestampMs: number): string {
  return formatShortDateTime(new Date(timestampMs).toISOString());
}

function formatDurationParts(totalMinutes: number): string {
  if (totalMinutes < 1) return '<1min';
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function formatTimeRemaining(
  endDateIso: string | null | undefined,
  now: number,
): string {
  if (!endDateIso) return '—';
  const ms = new Date(endDateIso).getTime() - now;
  if (ms <= 0) return 'Expiré';
  return formatDurationParts(Math.floor(ms / 60_000));
}

export function formatDurationBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  now?: number,
): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : (now ?? Date.now());
  const ms = Math.max(0, end - start);
  return formatDurationParts(Math.floor(ms / 60_000));
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '—';
  return formatDurationParts(Math.floor(ms / 60_000));
}
