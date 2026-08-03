/**
 * Formatting helpers for weather-algo position cards.
 */

export interface WeatherBucketBounds {
  low?: number;
  high?: number;
  target?: number;
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

export function bucketLabel(
  comparison: string | null,
  bounds: WeatherBucketBounds | null,
): string {
  if (!comparison || !bounds) return '—';
  switch (comparison) {
    case 'exact':
      return bounds.target != null ? `${bounds.target}°C exact` : '—';
    case 'between':
      return bounds.low != null && bounds.high != null
        ? `${bounds.low}°C – ${bounds.high}°C`
        : '—';
    case 'or_below':
      return bounds.target != null ? `≤ ${bounds.target}°C` : '—';
    case 'or_above':
      return bounds.target != null ? `≥ ${bounds.target}°C` : '—';
    default:
      return '—';
  }
}
