import pino from 'pino';
import type { MarketListItemDto, WeatherStrategyParamsBag } from '@polywatch/core';
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
 * Consensus / momentum strategy: at market open, picks the bucket with the
 * highest YES price (strongest market-implied probability) and holds it until
 * resolution. No forecast dependency — neither fetch nor weather comparison.
 */
export class WeatherHighestYesStrategy implements WeatherStrategy {
  readonly id = 'weather-highest-yes';
  private minYesPrice: number = 0.5;

  setRiskConfig(params: WeatherStrategyParamsBag): void {
    this.minYesPrice = params.minYesPrice;
  }

  async evaluate(
    market: MarketListItemDto,
    _ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
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
    return this.buildSignal(market, yesPrice, now);
  }

  async evaluateGroup(
    markets: MarketListItemDto[],
    _ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    let best: { market: MarketListItemDto; yesPrice: number } | null = null;

    for (const market of markets) {
      const yesPrice = this.extractYesPrice(market);
      if (yesPrice == null || yesPrice <= 0 || yesPrice < this.minYesPrice) {
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
