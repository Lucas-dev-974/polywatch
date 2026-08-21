import pino from 'pino';
import type { MarketListItemDto, WeatherStrategyParamsBag, WeatherComparison } from '@polywatch/core';
import {
  parseWeatherQuestion,
  binaryPricesFromParsed,
  binaryPricesToUpDown,
} from '@polywatch/core';
import type {
  WeatherStrategy,
  WeatherEvaluationContext,
  WeatherEvaluationResult,
  WeatherSignal,
} from './strategy.js';

const log = pino({ name: 'weather-algo:highest-yes-strategy' });

/**
 * Consensus / momentum strategy — fallback by design.
 *
 * Picks the bucket with the highest YES price (strongest market-implied
 * probability) among the active buckets of a city and holds it until
 * resolution. No forecast dependency: the strategy works even when weather
 * forecast data is unavailable, which is its primary role — a safety net that
 * trades cities the forecast-dependent strategies (weather-forecast,
 * weather-forecast-aligned) leave pass because of missing data.
 *
 * Because edge and dynamicMinEdge are forced to 0, this strategy never wins a
 * tie against a forecast strategy with a positive edge in selection mode
 * `single` (signals are sorted by descending edge). It only emits a tradable
 * signal when the forecast strategies abstain (e.g. forecast unavailable, all
 * buckets below minEdge). Treat it as a filet de sécurité, not a premier rang
 * strategy — it carries no view on whether the market price is right, only on
 * where the market consensus is strongest.
 *
 * `confidence` (min(1, yesPrice)) is an intensity signal stored for
 * observability (logs, reasons). The entry pipeline hardcodes the sizing
 * multiplier to 1, so confidence does NOT modulate the order size — a high
 * YES price does not produce a larger order.
 *
 * Use `allowedComparisons` to exclude cumulative buckets (or_above / or_below)
 * whose YES price is mechanically inflated by P(T ≥ threshold) and would
 * otherwise dominate the "highest YES" selection.
 */
export class WeatherHighestYesStrategy implements WeatherStrategy {
  readonly id = 'weather-highest-yes';
  private minYesPrice: number = 0.5;
  private maxYesPrice: number | null = null;
  private allowedComparisons: WeatherComparison[] | null = null;

  setRiskConfig(params: WeatherStrategyParamsBag): void {
    this.minYesPrice = params.minYesPrice;
    this.maxYesPrice = params.maxYesPrice ?? null;
    this.allowedComparisons =
      params.allowedComparisons && params.allowedComparisons.length > 0
        ? params.allowedComparisons
        : null;
  }

  async evaluate(
    market: MarketListItemDto,
    _ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    if (!this.isComparisonAllowed(market)) {
      return { kind: 'abstain', reason: 'comparison_not_allowed' };
    }
    const yesPrice = this.extractYesPrice(market);
    if (yesPrice == null) {
      return { kind: 'abstain', reason: 'no_market_prices' };
    }
    if (yesPrice <= 0) {
      return { kind: 'abstain', reason: 'zero_prices' };
    }
    if (yesPrice < this.minYesPrice) {
      return {
        kind: 'abstain',
        reason: 'yes_price_below_min',
        detail: `yesPrice=${yesPrice.toFixed(4)} < min=${this.minYesPrice.toFixed(4)}`,
      };
    }
    if (this.maxYesPrice != null && yesPrice > this.maxYesPrice) {
      return {
        kind: 'abstain',
        reason: 'yes_price_above_max',
        detail: `yesPrice=${yesPrice.toFixed(4)} > max=${this.maxYesPrice.toFixed(4)}`,
      };
    }
    return this.buildSignal(market, yesPrice, now);
  }

  async evaluateGroup(
    markets: MarketListItemDto[],
    _ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    let best: { market: MarketListItemDto; yesPrice: number } | null = null;

    for (const market of markets) {
      if (!this.isComparisonAllowed(market)) {
        continue;
      }
      const yesPrice = this.extractYesPrice(market);
      if (
        yesPrice == null ||
        yesPrice <= 0 ||
        yesPrice < this.minYesPrice ||
        (this.maxYesPrice != null && yesPrice > this.maxYesPrice)
      ) {
        continue;
      }
      if (!best || yesPrice > best.yesPrice) {
        best = { market, yesPrice };
      }
    }

    if (!best) {
      return { kind: 'abstain', reason: 'no_high_yes_bucket' };
    }

    log.debug(
      { conditionId: best.market.conditionId, yesPrice: best.yesPrice },
      'weather highest-yes strategy emitted signal',
    );
    return this.buildSignal(best.market, best.yesPrice, now);
  }

  /**
   * Whether the bucket's comparison type is eligible. null/empty
   * allowedComparisons = all accepted (backward-compatible default).
   */
  private isComparisonAllowed(market: MarketListItemDto): boolean {
    if (!this.allowedComparisons || this.allowedComparisons.length === 0) {
      return true;
    }
    if (!market.question) return false;
    const parsed = parseWeatherQuestion(market.question);
    if (!parsed) return false;
    return this.allowedComparisons.includes(parsed.comparison);
  }

  private extractYesPrice(market: MarketListItemDto): number | null {
    if (!market.question) {
      return null;
    }
    const parsed = parseWeatherQuestion(market.question);
    if (!parsed) {
      return null;
    }
    const sidePrices = binaryPricesFromParsed(market.outcomePrices ?? []);
    const { upPrice } = binaryPricesToUpDown(sidePrices);
    return upPrice;
  }

  private buildSignal(
    market: MarketListItemDto,
    yesPrice: number,
    now?: Date,
  ): WeatherEvaluationResult {
    const parsed = parseWeatherQuestion(market.question ?? '');
    const nowMs = now?.getTime() ?? Date.now();
    const targetDate = market.endDate ? new Date(market.endDate) : new Date(nowMs);

    const assetId = market.tokenIdYes;
    if (!assetId) {
      return { kind: 'abstain', reason: 'missing_token' };
    }

    const signal: WeatherSignal = {
      conditionId: market.conditionId,
      assetId,
      outcome: 'YES',
      side: 'BUY',
      confidence: Math.min(1, yesPrice),
      reasons: [
        'highest-yes',
        `yesPrice=${yesPrice.toFixed(4)}`,
        `bucket=${parsed?.comparison ?? 'unknown'}:${parsed?.targetValue ?? `${parsed?.targetValueLow}-${parsed?.targetValueHigh}`}`,
        `city=${parsed?.city ?? 'unknown'}`,
      ],
      strategyId: this.id,
      eventSlug: market.eventSlug ?? market.conditionId,
      city: parsed?.city ?? 'unknown',
      metric: parsed?.metric ?? 'highest_temp',
      targetDate,
      forecastMean: 0,
      forecastStdDev: 0,
      forecastProbability: 0,
      marketPrice: yesPrice,
      edge: 0,
      dynamicMinEdge: 0,
      entryBucketComparison: parsed?.comparison ?? null,
      entryBucketBounds: {
        low: parsed?.targetValueLow ?? null,
        high: parsed?.targetValueHigh ?? null,
        target: parsed?.targetValue ?? null,
      },
      unit: parsed?.unit ?? null,
    };

    return { kind: 'signal', signal };
  }
}
