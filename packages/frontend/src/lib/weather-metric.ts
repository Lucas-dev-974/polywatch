const METRIC_LABELS: Record<string, string> = {
  temp_max: 'Temp max',
  temp_min: 'Temp min',
  temp_avg: 'Temp moyenne',
  precip: 'Précipitations',
  precip_prob: 'Prob. précip.',
  wind: 'Vent',
  wind_max: 'Vent max',
  humidity: 'Humidité',
  cloud: 'Nuages',
  uv: 'UV',
};

export function formatMetric(metric: string | null | undefined): string {
  if (!metric) return '—';
  const mapped = METRIC_LABELS[metric];
  if (mapped) return mapped;
  const cleaned = metric.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return metric;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
