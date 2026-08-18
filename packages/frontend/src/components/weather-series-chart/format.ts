/**
 * Formate toujours la date ET l'heure pour le tooltip crosshair.
 * Inclut les secondes uniquement pour les spans très courts (≤ 15min).
 */
export function formatChartTooltipDateTime(t: number, spanMs: number): string {
  const d = new Date(t);
  const baseOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (spanMs > 0 && spanMs <= 15 * 60_000) {
    baseOptions.second = '2-digit';
  }
  return d.toLocaleString('fr-FR', baseOptions);
}
