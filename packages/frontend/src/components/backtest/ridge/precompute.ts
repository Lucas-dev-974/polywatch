import type { BacktestMarketSeriesDto } from '../../../api';
import type { EnrichedSeries, EnrichedPoint } from './types';

interface BacktestMarketSeriesPoint {
  t: string;
  yesPrice: number | null;
}

// Cache simple en mémoire (module-level) — durée de vie = session de backtest.
const enrichCache = new Map<string, EnrichedSeries>();

/**
 * Génère une clé de cache stable basée sur l'identité des données.
 * Utilise la référence du tableau `points` + métadonnées légères pour détecter un nouveau poll.
 */
function makeCacheKey(dto: BacktestMarketSeriesDto): string {
  const pts = dto.points;
  return `${dto.conditionId}|${pts.length}|${pts[0]?.t ?? ''}|${pts[pts.length - 1]?.t ?? ''}`;
}

/**
 * Enrichit une série : pré-parse les timestamps, pré-calcule bornes.
 * Coût O(n) one-shot. Mémoïsé avec invalidation par référence de `points`.
 */
export function enrichSeries(dto: BacktestMarketSeriesDto): EnrichedSeries {
  const key = makeCacheKey(dto);
  const cached = enrichCache.get(key);
  if (cached) return cached;

  const points: EnrichedPoint[] = [];
  let minT = Infinity;
  let maxT = -Infinity;

  for (const p of dto.points) {
    const t = Date.parse(p.t);
    if (Number.isNaN(t)) continue;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    points.push({ t, price: p.yesPrice ?? null });
  }

  // Les points sont déjà triés par t (données chronologiques).
  const enriched: EnrichedSeries = {
    conditionId: dto.conditionId,
    city: dto.city,
    targetDateIso: dto.targetDateIso,
    forecastMean: dto.forecastMean,
    forecastStdDev: dto.forecastStdDev,
    points,
    minT: points.length ? minT : Infinity,
    maxT: points.length ? maxT : -Infinity,
  };

  enrichCache.set(key, enriched);
  return enriched;
}

/** Vide le cache (utile pour les tests ou reset complet). */
export function clearEnrichCache(): void {
  enrichCache.clear();
}