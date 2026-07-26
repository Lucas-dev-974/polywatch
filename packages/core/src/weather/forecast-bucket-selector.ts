import type { MarketListItemDto } from '../polymarket/market-list.js';
import { parseWeatherQuestion, type ParsedWeatherQuestion } from './question-parser.js';

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

export interface BucketBounds {
  low?: number | null;
  high?: number | null;
  target?: number | null;
}

/**
 * Check whether a forecast mean falls inside a given temperature bucket.
 */
export function isForecastInBucket(
  forecastMean: number,
  comparison: 'exact' | 'between' | 'or_below' | 'or_above',
  bounds: BucketBounds,
): boolean {
  switch (comparison) {
    case 'between': {
      const low = bounds.low ?? -Infinity;
      const high = bounds.high ?? Infinity;
      return forecastMean >= low - 0.5 && forecastMean <= high + 0.5;
    }
    case 'exact': {
      const target = bounds.target ?? NaN;
      return Math.abs(forecastMean - target) <= 0.5;
    }
    case 'or_below': {
      const target = bounds.target ?? NaN;
      return forecastMean <= target;
    }
    case 'or_above': {
      const target = bounds.target ?? NaN;
      return forecastMean >= target;
    }
    default:
      return false;
  }
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
