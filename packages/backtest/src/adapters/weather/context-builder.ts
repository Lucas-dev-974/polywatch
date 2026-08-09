import type { MarketListItemDto } from '@polywatch/core';
import type { BookTickEventData, ForecastRevisionData } from '../../engine/events.js';
import { buildWeatherQuestion } from './question-builder.js';

/** A reconstructed market + current forecast revision for re-evaluation. */
export interface WeatherReconstructedMarket {
  market: MarketListItemDto;
  /** city the market belongs to. */
  city: string;
  /** target date ISO (used to look up the forecast revision). */
  targetDateIso: string;
  metric: string;
}

/**
 * Rebuilds a MarketListItemDto from a book tick + snapshot. The strategy's
 * parseWeatherQuestion needs a structured question text; we synthesize it when
 * the tick does not carry one.
 */
export function buildMarketListItem(input: {
  tick: BookTickEventData;
  city: string;
  targetDateIso: string;
  metric: string;
  eventSlug: string | null;
  tokenIdYes: string | null;
}): MarketListItemDto | null {
  const question = buildWeatherQuestion({
    question: input.tick.question,
    city: input.city,
    targetDateIso: input.targetDateIso,
    metric: input.metric,
    bucketComparison: input.tick.bucketComparison,
    bucketTarget: input.tick.bucketTarget,
    bucketLow: input.tick.bucketLow,
    bucketHigh: input.tick.bucketHigh,
  });
  if (!question) return null;

  const outcomePrices = [];
  if (input.tick.yesPrice != null) {
    outcomePrices.push({ outcome: 'YES', price: input.tick.yesPrice });
  }
  if (input.tick.noPrice != null) {
    outcomePrices.push({ outcome: 'NO', price: input.tick.noPrice });
  }

  return {
    conditionId: input.tick.conditionId,
    question,
    slug: null,
    eventSlug: input.eventSlug,
    icon: null,
    endDate: input.tick.endDate ? input.tick.endDate.toISOString() : null,
    startDate: null,
    volume: input.tick.volume,
    volume24hr: input.tick.volume24hr,
    liquidityClob: input.tick.liquidityClob,
    outcomePrices,
    outcomes: [],
    acceptingOrders: input.tick.acceptingOrders,
    closed: input.tick.closed ?? false,
    url: '',
    tokenIdYes: input.tokenIdYes,
    tokenIdNo: null,
    category: null,
    tagSlugs: [],
    cryptoSymbol: null,
    interval: null,
    cryptoCategory: null,
    marketType: 'standard' as never,
  };
}

/** In-memory store of the latest forecast revision per (city, date, metric). */
export class ForecastRevisionStore {
  private revisions = new Map<string, ForecastRevisionData>();

  private key(city: string, dateIso: string, metric: string): string {
    return `${city}\u0000${dateIso}\u0000${metric}`;
  }

  set(revision: ForecastRevisionData): void {
    const dateIso = revision.forecastDate.toISOString().slice(0, 10);
    this.revisions.set(this.key(revision.city, dateIso, revision.metric), revision);
  }

  /**
   * Returns the latest revision seen for a city/date/metric. Events arrive in
   * global timestamp order via merge-sort, so the store is as-of by construction.
   */
  get(city: string, dateIso: string, metric: string): ForecastRevisionData | null {
    return this.revisions.get(this.key(city, dateIso, metric)) ?? null;
  }
}
