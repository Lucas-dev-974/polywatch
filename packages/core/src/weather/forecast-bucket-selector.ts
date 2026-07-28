import type { MarketListItemDto } from '../polymarket/market-list.js';
import { parseWeatherQuestion, type ParsedWeatherQuestion } from './question-parser.js';
import { isForecastInBucket, type BucketBounds } from './weather-exit-helpers.js';

export interface BucketCandidate {
  conditionId: string;
  market: MarketListItemDto;
  parsed: ParsedWeatherQuestion;
}

export interface SelectedBucket {
  conditionId: string;
  market: MarketListItemDto;
  parsed: ParsedWeatherQuestion;
}

/**
 * Select the temperature bucket whose range best contains the forecast mean.
 *
 * Priority: between > exact > or_above/or_below (fallback for extremes).
 * When multiple buckets match at the same priority, pick the one whose
 * centre is closest to forecastMean.
 *
 * Returns null when no bucket matches (abstention).
 */
export function selectForecastAlignedBucket(
  forecastMean: number,
  buckets: BucketCandidate[],
): SelectedBucket | null {
  if (buckets.length === 0) return null;

  // Priority tiers: 0 = between, 1 = exact, 2 = or_above/or_below
  const tier = (c: string): number => {
    if (c === 'between') return 0;
    if (c === 'exact') return 1;
    return 2; // or_below / or_above
  };

  const centre = (p: ParsedWeatherQuestion): number => {
    if (p.comparison === 'between') {
      return ((p.targetValueLow ?? 0) + (p.targetValueHigh ?? 0)) / 2;
    }
    return p.targetValue ?? 0;
  };

  let best: SelectedBucket | null = null;
  let bestTier = Infinity;
  let bestDist = Infinity;

  for (const b of buckets) {
    const bounds: BucketBounds = {
      low: b.parsed.targetValueLow,
      high: b.parsed.targetValueHigh,
      target: b.parsed.targetValue,
    };

    if (!isForecastInBucket(forecastMean, b.parsed.comparison, bounds)) continue;

    const t = tier(b.parsed.comparison);
    const dist = Math.abs(forecastMean - centre(b.parsed));

    if (t < bestTier || (t === bestTier && dist < bestDist)) {
      best = { conditionId: b.conditionId, market: b.market, parsed: b.parsed };
      bestTier = t;
      bestDist = dist;
    }
  }

  return best;
}
