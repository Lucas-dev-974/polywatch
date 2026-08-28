import {
  type MarketListItemDto,
  type WeatherConfig,
  type TradingMode,
  isMarketActiveForWeather,
  resolveEnabledWeatherStrategiesForMode,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  type WeatherStrategyId,
} from '@polywatch/core';
import type { WeatherSignal } from '@polywatch/weather-algo';
import {
  dedupSignalsByCityDate,
  applySelectionMode,
} from '@polywatch/weather-algo';
import type { BookTickEventData } from '../../engine/events.js';
import { buildMarketListItem } from './context-builder.js';
import type { ClockedWeatherStrategy } from './clocked-weather-strategy.js';
import { createWeatherStrategy } from './clocked-weather-strategy.js';

export type BucketGroupKey = string;

export function bucketGroupKey(city: string, targetDateIso: string, metric: string): BucketGroupKey {
  return `${city.toLowerCase()}\u0000${targetDateIso}\u0000${metric}`;
}

/** Tracks the latest book tick per bucket within each city/date/metric group. */
export class BucketGroupStore {
  private groups = new Map<BucketGroupKey, Map<string, BookTickEventData>>();

  upsert(tick: BookTickEventData): BucketGroupKey {
    const key = bucketGroupKey(tick.snapshotCity, tick.snapshotTargetDateIso, tick.snapshotMetric);
    let buckets = this.groups.get(key);
    if (!buckets) {
      buckets = new Map();
      this.groups.set(key, buckets);
    }
    buckets.set(tick.conditionId, tick);
    return key;
  }

  ticksForGroup(key: BucketGroupKey): BookTickEventData[] {
    const buckets = this.groups.get(key);
    return buckets ? [...buckets.values()] : [];
  }
}

export function buildActiveMarketsForGroup(
  ticks: BookTickEventData[],
  nowMs: number,
  onExcluded?: (
    tick: BookTickEventData,
    reason: 'unsupported_metric_or_bucket' | 'market_lifecycle_filtered',
  ) => void,
): MarketListItemDto[] {
  const markets: MarketListItemDto[] = [];
  for (const tick of ticks) {
    const market = buildMarketListItem({
      tick,
      city: tick.snapshotCity,
      targetDateIso: tick.snapshotTargetDateIso,
      metric: tick.snapshotMetric,
      eventSlug: tick.eventSlug,
      tokenIdYes: tick.tokenIdYes,
    });
    if (!market) {
      onExcluded?.(tick, 'unsupported_metric_or_bucket');
      continue;
    }
    if (!isMarketActiveForWeather(market, nowMs)) {
      onExcluded?.(tick, 'market_lifecycle_filtered');
      continue;
    }
    markets.push(market);
  }
  return markets;
}

export function createRunnerSimStrategies(
  config: WeatherConfig,
  overrideStrategyId?: WeatherStrategyId,
  strategyEnv: TradingMode = 'sim',
): ClockedWeatherStrategy[] {
  const enabled = overrideStrategyId
    ? [overrideStrategyId]
    : resolveEnabledWeatherStrategiesForMode(config, strategyEnv);
  return enabled.map((id) => createWeatherStrategy(id));
}

/**
 * Mirrors live runner evaluateCityFollowDateGroup: first enabled strategy that
 * emits a signal wins.
 */
export async function evaluateRunnerSimGroup(
  strategies: ClockedWeatherStrategy[],
  activeMarkets: MarketListItemDto[],
  ctx: { forecastMean: number; forecastStdDev: number; mode: TradingMode },
  now: Date,
): Promise<WeatherSignal | null> {
  if (activeMarkets.length === 0) return null;

  // forecast-dependent strategies must abstain when the forecast is a null
  // placeholder (0/0). stdDev=0 makes normalCDF a step function and would
  // produce phantom signals with edge≈1 on low-target `or_below` buckets,
  // shadowing highest-yes (edge=0).
  const forecastAvailable = ctx.forecastMean !== 0 || ctx.forecastStdDev !== 0;

  for (const strategy of strategies) {
    if (!forecastAvailable && strategy.id !== WEATHER_HIGHEST_YES_STRATEGY_ID) {
      continue;
    }
    let result;
    if (strategy.evaluateGroup) {
      result = await strategy.evaluateGroup(activeMarkets, ctx, now);
    } else {
      result = { kind: 'abstain' as const, reason: 'no_group_evaluator' };
      for (const market of activeMarkets) {
        result = await strategy.evaluate(market, ctx, now);
        if (result.kind === 'signal') break;
      }
    }
    if (result.kind === 'signal') {
      return result.signal;
    }
  }
  return null;
}

/** Apply the same post-processing as the live runner before entry. */
export function selectRunnerSimSignals(
  signals: WeatherSignal[],
  risk: WeatherConfig,
): WeatherSignal[] {
  return applySelectionMode(dedupSignalsByCityDate(signals), risk);
}
