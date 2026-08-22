/**
 * Formatting helpers for weather-algo position cards.
 */

export interface WeatherBucketBounds {
  low?: number;
  high?: number;
  target?: number;
}

export type WeatherUnit = 'celsius' | 'fahrenheit' | null;

function unitSuffix(unit: WeatherUnit): string {
  if (unit === 'fahrenheit') return '°F';
  if (unit === 'celsius') return '°C';
  return '';
}

export function formatWeatherDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatPnL(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} USDC`;
}

export function pnlClass(value: number): string {
  if (value > 0) return 'weather-pnl-positive';
  if (value < 0) return 'weather-pnl-negative';
  return 'weather-pnl-neutral';
}

export function formatBucketLabel(
  comparison: string | null,
  bounds: WeatherBucketBounds | null,
  unit: WeatherUnit = 'celsius',
): string {
  if (!comparison || !bounds) return '—';
  const suffix = unitSuffix(unit);
  switch (comparison) {
    case 'exact':
      return bounds.target != null ? `${bounds.target}${suffix}` : '—';
    case 'between':
      return bounds.low != null && bounds.high != null
        ? `${bounds.low}${suffix} – ${bounds.high}${suffix}`
        : '—';
    case 'or_below':
      return bounds.target != null ? `≤ ${bounds.target}${suffix}` : '—';
    case 'or_above':
      return bounds.target != null ? `≥ ${bounds.target}${suffix}` : '—';
    default:
      return '—';
  }
}

export function formatTimelineBucketLabel(
  bucket: {
    bucketComparison: string | null;
    bucketTarget: number | null;
    bucketLow: number | null;
    bucketHigh: number | null;
    unit?: WeatherUnit;
  },
  unit: WeatherUnit = bucket.unit ?? null,
): string {
  return formatBucketLabel(
    bucket.bucketComparison,
    {
      target: bucket.bucketTarget ?? undefined,
      low: bucket.bucketLow ?? undefined,
      high: bucket.bucketHigh ?? undefined,
    },
    unit,
  );
}

export function formatBucketTargetLabel(
  bucket: {
    bucketComparison: string | null;
    bucketTarget: number | null;
    bucketLow: number | null;
    bucketHigh: number | null;
    unit?: WeatherUnit;
  },
  unit: WeatherUnit = bucket.unit ?? null,
): string {
  const suffix = unitSuffix(unit);
  const fmt = (v: number | null) => (v == null ? '?' : `${v}${suffix}`);
  if (bucket.bucketComparison === 'between' && bucket.bucketLow != null && bucket.bucketHigh != null) {
    return `${fmt(bucket.bucketLow)}–${fmt(bucket.bucketHigh)}`;
  }
  return fmt(bucket.bucketTarget);
}

export interface WeatherChartPoint {
  t: number;
  y: number | null;
}

/**
 * Projette une série de ticks bucket (`recordedAt` + `yesPrice`) vers les
 * points utilisés par les graphiques `SeriesChart`. Mutualisé entre le dialog
 * de position et la vue timeline bucket de l'onglet Données.
 */
export function toChartPoints(
  series: Array<{ recordedAt: string; yesPrice: number | null }>,
): WeatherChartPoint[] {
  return series.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    y: p.yesPrice,
  }));
}
