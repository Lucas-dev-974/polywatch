import { closeExecutionErrorLabel } from './execution';

/**
 * Formatting helpers for weather-algo position cards.
 */

export interface WeatherBucketBounds {
  low?: number;
  high?: number;
  target?: number;
}

export type WeatherUnit = 'celsius' | 'fahrenheit' | null;

/** Libellés courts des stratégies weather connues (fallback hors catalogue). */
const WEATHER_STRATEGY_LABELS: Record<string, string> = {
  'weather-forecast': 'Forecast (best edge)',
  'weather-forecast-aligned': 'Forecast (aligned)',
  'weather-highest-yes': 'Highest YES',
};

/**
 * Libellé lisible d'une stratégie weather. Retourne l'id brut si inconnu.
 * Utilisé pour les badges positions / exécutions (item multi-strategy badge).
 */
export function weatherStrategyLabel(strategyId: string | null | undefined): string | null {
  if (!strategyId) return null;
  return WEATHER_STRATEGY_LABELS[strategyId] ?? strategyId;
}

/** Cancelled pending that never filled — a failed open, not a history position. */
export function isNeverOpenedCancelled(input: {
  status: string;
  openedAt?: string | null;
}): boolean {
  return input.status === 'cancelled' && (input.openedAt == null || input.openedAt === '');
}

export function weatherHistoryCloseReasonLabel(
  closeReason: string | null | undefined,
): string | undefined {
  if (!closeReason) return undefined;
  return closeExecutionErrorLabel(closeReason) ?? closeReason;
}

/**
 * Positions tab chips: Tous / Live / Sim.
 * Stored CopiedPosition.mode is `real` | `sim`; the Live chip value is `live`.
 */
export function matchesWeatherPosMode(
  posMode: string,
  filter: 'all' | 'live' | 'sim',
): boolean {
  if (filter === 'all') return true;
  if (filter === 'sim') return posMode === 'sim';
  return posMode === 'real' || posMode === 'live';
}

function unitSuffix(unit: WeatherUnit): string {
  if (unit === 'fahrenheit') return '°F';
  if (unit === 'celsius') return '°C';
  return '';
}

/** Inverse of the question parser's fToC (1 decimal). */
function cToF(c: number): number {
  return Math.round((((c * 9) / 5) + 32) * 10) / 10;
}

/**
 * Bucket numbers are stored in Celsius (parser converts F questions to C
 * for forecast math) while `unit` keeps the market's original scale.
 *
 * Trust `unit` first. Convert C->F only when the converted value is a
 * plausible city daily high. 102 already in F becomes 215.6 F, which is
 * not a city weather temp, so it is left untouched (do not treat 102 F as C).
 */
export function displayBucketTemp(value: number, unit: WeatherUnit): number {
  if (unit !== 'fahrenheit') return value;
  const asF = cToF(value);
  if (asF > 140 || asF < -50) return value;
  return asF;
}

export function formatWeatherDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatPnL(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} pUSD`;
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
  const fmt = (v: number) => `${displayBucketTemp(v, unit)}${suffix}`;
  switch (comparison) {
    case 'exact':
      return bounds.target != null ? fmt(bounds.target) : '—';
    case 'between':
      return bounds.low != null && bounds.high != null
        ? `${fmt(bounds.low)} – ${fmt(bounds.high)}`
        : '—';
    case 'or_below':
      return bounds.target != null ? `≤ ${fmt(bounds.target)}` : '—';
    case 'or_above':
      return bounds.target != null ? `≥ ${fmt(bounds.target)}` : '—';
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
  const fmt = (v: number | null) =>
    v == null ? '?' : `${displayBucketTemp(v, unit)}${suffix}`;
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
