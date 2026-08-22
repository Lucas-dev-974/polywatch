import type { BacktestMarketSeriesDto, BacktestPositionDto } from '../../../api';
import { formatBucketLabel } from '../../../lib/weather-position';
import { seriesColor } from '../../weather-series-chart/palette';
import type { VoieGroup } from './types';

export const MIN_AVG_YES = 0.2;

/** Prix YES moyen d'une série (ignore les points null). 0 si aucun point valide. */
export function avgYesPrice(s: BacktestMarketSeriesDto): number {
  let sum = 0;
  let count = 0;
  for (const p of s.points) {
    if (p.yesPrice == null) continue;
    sum += p.yesPrice;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/** Clé de tri des buckets d'une même row (borne basse pour "between", sinon cible). */
function bucketSortKey(s: BacktestMarketSeriesDto): number {
  return s.bucketComparison === 'between' ? (s.bucketLow ?? Infinity) : (s.bucketTarget ?? Infinity);
}

/** Libellé lisible d'un bucket. */
export function bucketLabel(s: BacktestMarketSeriesDto): string {
  return formatBucketLabel(
    s.bucketComparison,
    {
      target: s.bucketTarget ?? undefined,
      low: s.bucketLow ?? undefined,
      high: s.bucketHigh ?? undefined,
    },
    s.unit ?? null,
  );
}

/**
 * Regroupe les séries par (ville, date cible), ne garde que celles dont le
 * prix moyen > `minAvgYes`, et trie les buckets de chaque row par borne.
 */
export function groupVoies(
  series: BacktestMarketSeriesDto[],
  positions: BacktestPositionDto[],
  minAvgYes = MIN_AVG_YES,
): VoieGroup[] {
  const posByCondition = new Map<string, BacktestPositionDto>();
  for (const p of positions) {
    if (!posByCondition.has(p.conditionId)) posByCondition.set(p.conditionId, p);
  }
  const map = new Map<string, VoieGroup>();
  for (const s of series) {
    if (avgYesPrice(s) <= minAvgYes) continue;
    const city = s.city ?? '_';
    const date = s.targetDateIso ? s.targetDateIso.slice(0, 10) : '_';
    const key = `${city}|${date}`;
    let group = map.get(key);
    if (!group) {
      group = {
        city: s.city ?? null,
        date,
        forecastMean: s.forecastMean ?? null,
        forecastStdDev: s.forecastStdDev ?? null,
        buckets: [],
        positionBuckets: [],
      };
      map.set(key, group);
    } else if (group.forecastMean == null && s.forecastMean != null) {
      // Un bucket du même groupe apporte la prévision manquante.
      group.forecastMean = s.forecastMean;
      group.forecastStdDev = s.forecastStdDev ?? null;
    }
    const bucketLine = {
      series: s,
      color: seriesColor(group.buckets.length),
      position: posByCondition.get(s.conditionId) ?? null,
    };
    group.buckets.push(bucketLine);
    if (bucketLine.position) group.positionBuckets.push(bucketLine);
  }
  const result = [...map.values()];
  for (const g of result) {
    g.buckets.sort((a, b) => bucketSortKey(a.series) - bucketSortKey(b.series));
  }
  return result;
}
