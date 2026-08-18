/** Formate un timestamp pour les cartes ville (heure si span court, sinon date + heure). */
export function formatChartTime(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
