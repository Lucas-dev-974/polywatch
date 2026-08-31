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

/** Standalone strategy: pick the bucket with the max YES price; no forecast. */
export class WeatherHighestYesStrategy implements WeatherStrategy {
  readonly id = 'weather-highest-yes';
  private minYesPrice: number = 0.5;
  private maxYesPrice: number | null = null;
  private allowedComparisons: WeatherComparison[] | null = null;

  setRiskConfig(params: WeatherStrategyParamsBag): void {
    this.minYesPrice = params.minYesPrice ?? 0.5;
    this.maxYesPrice = params.maxYesPrice ?? null;
    this.allowedComparisons =
      params.allowedComparisons && params.allowedComparisons.length > 0
        ? params.allowedComparisons
        : null;
  }

  async evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
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
    return this.buildSignal(market, yesPrice, ctx, now);
  }

  async evaluateGroup(
    markets: MarketListItemDto[],
    ctx: WeatherEvaluationContext,
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
    return this.buildSignal(best.market, best.yesPrice, ctx, now);
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
    ctx: WeatherEvaluationContext,
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
      mode: ctx.mode,
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
