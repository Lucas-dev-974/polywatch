import {
  fetchGammaMarketsByTagSlug,
  type MarketListItemDto,
} from '../polymarket/market-list.js';
import { parseWeatherQuestion, resolveWeatherDate } from './question-parser.js';
import type { WeatherMetric } from './metric.js';
import pino from 'pino';

export const WEATHER_TAG_SLUG = 'weather';

/** Max number of pages to fetch from Gamma (100 events per page). */
const MAX_PAGES = 10;

const log = pino({ name: 'core:weather-market-discovery' });

export interface WeatherMarketDiscoveryResult {
  /** Markets that matched the temperature question parser. */
  temperatureMarkets: MarketListItemDto[];
  /** All weather-tagged markets matching the target date (for the UI). */
  allWeatherMarkets: MarketListItemDto[];
  /** Markets grouped by city → date for the discovery dropdown UI. */
  byCity: DiscoverCityGroup[];
}

export async function discoverWeatherMarkets(
  options?: {
    limit?: number;
    offset?: number;
    targetDate?: Date;
    targetDates?: Date[];
    onParseResult?: (parsed: boolean) => void;
  },
): Promise<WeatherMarketDiscoveryResult> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 100));
  const offset = Math.max(0, options?.offset ?? 0);

  const today = defaultToday();
  const tomorrow = defaultTomorrow();
  const targetDates =
    options?.targetDates && options.targetDates.length > 0
      ? options.targetDates
      : options?.targetDate
        ? [options.targetDate]
        : [tomorrow, today];

  const targetStrs = new Set(targetDates.map((d) => d.toISOString().slice(0, 10)));
  const targetMonthDays = new Set(
    targetDates.map((d) =>
      d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    ),
  );
  const onParseResult = options?.onParseResult;

  function matchesTargetDate(m: MarketListItemDto): boolean {
    return matchMarketToTargetDates(m, targetStrs, targetMonthDays, onParseResult);
  }

  // Paginate through ALL Gamma events to find markets matching the target dates.
  // Temperature markets for J+1 are often deep in the volume-sorted list
  // (after J markets), so we must fetch all pages, not stop early.
  const allItems: MarketListItemDto[] = [];
  let currentOffset = offset;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await fetchGammaMarketsByTagSlug({
      tagSlug: WEATHER_TAG_SLUG,
      closed: false,
      active: true,
      limit,
      offset: currentOffset,
      includeAllMarkets: true,
    });
    allItems.push(...items);

    if (!nextCursor) break;
    currentOffset = Number(nextCursor);
  }

  const temperatureMarkets = allItems.filter((m) => {
    if (!m.question) return false;
    const parsed = parseWeatherQuestion(m.question);
    if (!parsed) return false;
    return matchesTargetDate(m);
  });

  const allWeatherMarkets = allItems.filter((m) => matchesTargetDate(m));

  // City → date → markets hierarchy for the discovery UI (highest_temp only).
  const byCity = groupMarketsByCityAndDate(allWeatherMarkets, 'highest_temp');

  log.info(
    {
      totalFetched: allItems.length,
      temperatureMarkets: temperatureMarkets.length,
      allWeatherMarkets: allWeatherMarkets.length,
      cityGroups: byCity.length,
      dateBuckets: byCity.reduce((n, c) => n + c.dates.length, 0),
      targetDates: Array.from(targetStrs),
      targetMonthDays: Array.from(targetMonthDays),
      parisMarkets: allItems.filter((m) => m.question?.toLowerCase().includes('paris')).length,
      parisHighestTempJuly25: allItems.filter(
        (m) =>
          m.question?.toLowerCase().includes('paris') &&
          m.question?.toLowerCase().includes('highest temperature') &&
          m.question?.toLowerCase().includes('july 25'),
      ).length,
    },
    'weather market discovery summary',
  );

  for (const m of allItems) {
    if (m.question?.toLowerCase().includes('paris')) {
      log.debug({
        conditionId: m.conditionId,
        question: m.question,
        parsed: parseWeatherQuestion(m.question),
        endDate: m.endDate,
        matchesDate: matchesTargetDate(m),
      }, 'paris market detail');
    }
  }

  return {
    temperatureMarkets,
    allWeatherMarkets,
    byCity,
  };
}

/**
 * Default number of past days to scan for resolved weather markets.
 * Resolved markets only concern dates that already passed.
 */
export const DEFAULT_RESOLVED_LOOKBACK_DAYS = 2;

/**
 * Check whether a weather market matches any of the target dates.
 *
 * Matches by the parsed question date string (e.g. "August 8") and by the
 * market endDate. Shared by the live discovery (open markets) and the resolved
 * discovery (closed markets).
 */
export function matchMarketToTargetDates(
  m: MarketListItemDto,
  targetStrs: Set<string>,
  targetMonthDays: Set<string>,
  onParseResult?: (parsed: boolean) => void,
): boolean {
  if (m.question) {
    const parsed = parseWeatherQuestion(m.question);
    onParseResult?.(parsed != null);
    if (parsed && targetMonthDays.has(parsed.dateString)) return true;
  }
  if (m.endDate) {
    const endStr = new Date(m.endDate).toISOString().slice(0, 10);
    if (targetStrs.has(endStr)) return true;
  }
  return false;
}

/**
 * Fetch resolved (closed) weather markets over a rolling past-day window and
 * return the ones matching a temperature question. Used solely for snapshot
 * recording so the winning bucket's YES price at resolution (1.00) is captured —
 * it never feeds the live trading path.
 */
export interface ResolvedWeatherMarketsResult {
  /** Resolved weather temperature markets matching the past target window. */
  resolvedTemperatureMarkets: MarketListItemDto[];
}

export async function discoverResolvedWeatherMarkets(
  options: {
    lookbackDays?: number;
    onParseResult?: (parsed: boolean) => void;
  } = {},
): Promise<ResolvedWeatherMarketsResult> {
  const lookback = Math.max(1, options.lookbackDays ?? DEFAULT_RESOLVED_LOOKBACK_DAYS);
  const targetDates = buildPastDates(lookback);
  const targetStrs = new Set(targetDates.map((d) => d.toISOString().slice(0, 10)));
  const targetMonthDays = new Set(
    targetDates.map((d) =>
      d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    ),
  );
  const onParseResult = options.onParseResult;

  const allItems: MarketListItemDto[] = [];
  let currentOffset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await fetchGammaMarketsByTagSlug({
      tagSlug: WEATHER_TAG_SLUG,
      closed: true,
      limit: 100,
      offset: currentOffset,
      includeAllMarkets: true,
    });
    allItems.push(...items);

    if (!nextCursor) break;
    currentOffset = Number(nextCursor);
  }

  const resolvedTemperatureMarkets = allItems.filter((m) => {
    if (!m.question) return false;
    const parsed = parseWeatherQuestion(m.question);
    if (!parsed) return false;
    return matchMarketToTargetDates(m, targetStrs, targetMonthDays, onParseResult);
  });

  log.info(
    {
      totalFetched: allItems.length,
      resolvedTemperatureMarkets: resolvedTemperatureMarkets.length,
      lookbackDays: lookback,
      targetStrs: Array.from(targetStrs),
    },
    'resolved weather markets discovery summary',
  );

  return { resolvedTemperatureMarkets };
}

/** Max pages when scanning Gamma for a bounded date range (100 events/page). */
const MAX_RANGE_PAGES = 50;

export interface DiscoverWeatherMarketsInRangeOptions {
  city: string;
  from: Date;
  to: Date;
  metric?: WeatherMetric;
}

export interface WeatherMarketsInRangeResult {
  markets: MarketListItemDto[];
  byCity: DiscoverCityGroup[];
}

function toUtcDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Inclusive UTC date-range check on a market's resolved target date. */
export function matchMarketToDateRange(
  m: MarketListItemDto,
  fromIso: string,
  toIso: string,
): boolean {
  const targetIso = resolveMarketTargetDateIso(m);
  if (!targetIso || targetIso === 'unknown') return false;
  return targetIso >= fromIso && targetIso <= toIso;
}

function matchesCityAndMetric(
  m: MarketListItemDto,
  cityNormalized: string,
  metric: WeatherMetric,
): boolean {
  if (!m.question) return false;
  const parsed = parseWeatherQuestion(m.question);
  if (!parsed) return false;
  if (parsed.metric !== metric) return false;
  return parsed.city.trim().toLowerCase() === cityNormalized;
}

async function fetchWeatherMarketsByClosedFlag(
  closed: boolean,
  endDateMin: string,
  endDateMax: string,
): Promise<MarketListItemDto[]> {
  const allItems: MarketListItemDto[] = [];
  let currentOffset = 0;

  for (let page = 0; page < MAX_RANGE_PAGES; page++) {
    const { items, nextCursor } = await fetchGammaMarketsByTagSlug({
      tagSlug: WEATHER_TAG_SLUG,
      closed,
      active: closed ? undefined : true,
      limit: 100,
      offset: currentOffset,
      endDateMin,
      endDateMax,
      includeAllMarkets: true,
    });
    allItems.push(...items);
    if (!nextCursor) break;
    currentOffset = Number(nextCursor);
  }

  return allItems;
}

/**
 * Discover weather temperature markets for one city over an inclusive UTC date
 * range. Scans both closed and open Gamma events bounded by end_date_min/max.
 */
export async function discoverWeatherMarketsInRange(
  options: DiscoverWeatherMarketsInRangeOptions,
): Promise<WeatherMarketsInRangeResult> {
  const metric = options.metric ?? 'highest_temp';
  const cityNormalized = options.city.trim().toLowerCase();
  const fromIso = toUtcDateIso(options.from);
  const toIso = toUtcDateIso(options.to);

  const endDateMin = addUtcDays(options.from, -1).toISOString();
  const endDateMax = addUtcDays(options.to, 1).toISOString();

  const [closedItems, openItems] = await Promise.all([
    fetchWeatherMarketsByClosedFlag(true, endDateMin, endDateMax),
    fetchWeatherMarketsByClosedFlag(false, endDateMin, endDateMax),
  ]);

  const byCondition = new Map<string, MarketListItemDto>();
  for (const m of [...closedItems, ...openItems]) {
    byCondition.set(m.conditionId, m);
  }

  const markets = Array.from(byCondition.values()).filter(
    (m) =>
      matchesCityAndMetric(m, cityNormalized, metric) &&
      matchMarketToDateRange(m, fromIso, toIso),
  );

  log.info(
    {
      city: options.city,
      fromIso,
      toIso,
      metric,
      closedFetched: closedItems.length,
      openFetched: openItems.length,
      matched: markets.length,
    },
    'weather markets in range discovery summary',
  );

  const byCity = groupMarketsByCityAndDate(markets, metric).filter(
    (g) => g.city.trim().toLowerCase() === cityNormalized,
  );

  return { markets, byCity };
}

/** Builds [today - lookback, ..., yesterday] at midnight UTC. */
function buildPastDates(days: number): Date[] {
  const out: Date[] = [];
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  for (let i = days; i >= 1; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d);
  }
  return out;
}

/** Returns today at midnight UTC. */
function defaultToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Returns tomorrow at midnight UTC. */
function defaultTomorrow(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Group markets by their event slug. Markets sharing the same eventSlug
 * belong to the same negRisk multi-outcome event (e.g. all temperature
 * options for "Hong Kong July 24").
 */
export function groupMarketsByEvent(
  markets: MarketListItemDto[],
): Map<string, MarketListItemDto[]> {
  const groups = new Map<string, MarketListItemDto[]>();
  for (const m of markets) {
    const key = m.eventSlug ?? m.conditionId;
    const arr = groups.get(key);
    if (arr) arr.push(m);
    else groups.set(key, [m]);
  }
  return groups;
}

/**
 * A group of weather markets sharing the same city.
 * The `city` field is the display name; `markets` is the flat list of markets for that city.
 */
export interface CityMarketGroup {
  city: string;
  markets: MarketListItemDto[];
}

/** Markets for one city on one calendar day (discovery UI date dropdown). */
export interface DiscoverDateBucket {
  /** ISO calendar date YYYY-MM-DD (UTC). */
  date: string;
  /** Server-formatted label for the date dropdown. */
  dateLabel: string;
  markets: MarketListItemDto[];
}

/** City node for discovery: Ville → dates → marchés. */
export interface DiscoverCityGroup {
  city: string;
  /** Server-formatted label for the city dropdown (includes market count). */
  cityLabel: string;
  dates: DiscoverDateBucket[];
}

export type ForecastStatus = 'fresh' | 'stale' | 'unavailable';

export interface ForecastEnrichedDateBucket extends DiscoverDateBucket {
  /** Forecast mean temperature in °C. Null when no forecast is available. */
  forecastMean: number | null;
  /** Forecast standard deviation in °C. Null when no forecast is available. */
  forecastStdDev: number | null;
  /** Source status for the displayed forecast. */
  forecastStatus: ForecastStatus;
}

/** Forecast-enriched city → date hierarchy for the discovery API. */
export interface ForecastEnrichedCityGroup {
  city: string;
  cityLabel: string;
  dates: ForecastEnrichedDateBucket[];
}

/**
 * Resolve the canonical target date for a city group.
 * Prefers the parsed dateString from the first parsable market question.
 * Falls back to the first market endDate.
 * Final fallback: tomorrow (J+1) — consistent with discoverWeatherMarkets default.
 */
export function resolveGroupTargetDate(group: CityMarketGroup): Date {
  for (const m of group.markets) {
    if (m.question) {
      const parsed = parseWeatherQuestion(m.question);
      if (parsed) {
        const resolved = resolveWeatherDate(parsed.dateString);
        if (!Number.isNaN(resolved.getTime())) return resolved;
      }
    }
    if (m.endDate) {
      const d = new Date(m.endDate);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  // Final fallback: tomorrow (J+1), consistent with discoverWeatherMarkets default.
  return defaultTomorrow();
}

/**
 * Group a flat list of weather markets by city, extracted via parseWeatherQuestion.
 * Markets whose city cannot be parsed are placed under the fallback label "Autres".
 * Groups are sorted alphabetically by city, with "Autres" always last.
 *
 * @param markets - Flat list of MarketListItemDto (typically from discoverWeatherMarkets)
 * @param metricFilter - Optional: only include markets matching this metric ('highest_temp' | 'lowest_temp'). Default: no filter.
 */
export function groupMarketsByCity(
  markets: MarketListItemDto[],
  metricFilter?: WeatherMetric,
): CityMarketGroup[] {
  const map = new Map<string, CityMarketGroup>();

  for (const m of markets) {
    const parsed = m.question ? parseWeatherQuestion(m.question) : null;

    // When a metric filter is active, unparseable markets must be excluded
    // entirely rather than falling back to "Autres".
    if (!parsed) {
      if (metricFilter) continue;
      // Unparseable → "Autres"
      const group = map.get('autres') ?? { city: 'Autres', markets: [] };
      group.markets.push(m);
      map.set('autres', group);
      continue;
    }

    // Optional metric filter
    if (metricFilter && parsed.metric !== metricFilter) continue;

    const key = parsed.city.trim().toLowerCase();
    // Preserve the first-seen casing for display
    const existing = map.get(key);
    if (existing) {
      existing.markets.push(m);
    } else {
      map.set(key, { city: parsed.city.trim(), markets: [m] });
    }
  }

  // Sort: named cities alphabetically, "Autres" always last
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.city === 'Autres') return 1;
    if (b.city === 'Autres') return -1;
    return a.city.localeCompare(b.city);
  });

  return groups;
}

/** Format an ISO date (YYYY-MM-DD) for the discovery date dropdown (fr-FR, UTC). */
export function formatDiscoverDateLabel(isoDate: string, marketCount: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return `${isoDate} (${marketCount})`;
  }
  const formatted = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatted} (${marketCount})`;
}

export function formatDiscoverCityLabel(city: string, marketCount: number): string {
  return `${city} (${marketCount})`;
}

/** Resolve the calendar date (YYYY-MM-DD UTC) for a weather market. */
export function resolveMarketTargetDateIso(market: MarketListItemDto): string | null {
  if (market.question) {
    const parsed = parseWeatherQuestion(market.question);
    if (parsed) {
      const resolved = resolveWeatherDate(parsed.dateString);
      if (!Number.isNaN(resolved.getTime())) {
        return resolved.toISOString().slice(0, 10);
      }
    }
  }
  if (market.endDate) {
    const d = new Date(market.endDate);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function marketTempSortKey(market: MarketListItemDto): number {
  if (!market.question) return Number.POSITIVE_INFINITY;
  const parsed = parseWeatherQuestion(market.question);
  if (!parsed) return Number.POSITIVE_INFINITY;
  if (parsed.targetValue != null) return parsed.targetValue;
  if (parsed.targetValueLow != null) return parsed.targetValueLow;
  return Number.POSITIVE_INFINITY;
}

/**
 * Group weather markets as Ville → Date → marchés for the discovery UI.
 * Labels are formatted server-side for direct use in dropdowns.
 */
export function groupMarketsByCityAndDate(
  markets: MarketListItemDto[],
  metricFilter?: WeatherMetric,
): DiscoverCityGroup[] {
  type DateAcc = { date: string; markets: MarketListItemDto[] };
  type CityAcc = { city: string; dates: Map<string, DateAcc> };

  const cityMap = new Map<string, CityAcc>();

  for (const m of markets) {
    const parsed = m.question ? parseWeatherQuestion(m.question) : null;

    if (!parsed) {
      if (metricFilter) continue;
      const dateIso = resolveMarketTargetDateIso(m) ?? 'unknown';
      const cityKey = 'autres';
      const cityAcc = cityMap.get(cityKey) ?? { city: 'Autres', dates: new Map() };
      const dateAcc = cityAcc.dates.get(dateIso) ?? { date: dateIso, markets: [] };
      dateAcc.markets.push(m);
      cityAcc.dates.set(dateIso, dateAcc);
      cityMap.set(cityKey, cityAcc);
      continue;
    }

    if (metricFilter && parsed.metric !== metricFilter) continue;

    const dateIso = resolveMarketTargetDateIso(m);
    if (!dateIso) continue;

    const cityKey = parsed.city.trim().toLowerCase();
    const cityAcc = cityMap.get(cityKey) ?? {
      city: parsed.city.trim(),
      dates: new Map(),
    };
    const dateAcc = cityAcc.dates.get(dateIso) ?? { date: dateIso, markets: [] };
    dateAcc.markets.push(m);
    cityAcc.dates.set(dateIso, dateAcc);
    cityMap.set(cityKey, cityAcc);
  }

  const groups: DiscoverCityGroup[] = Array.from(cityMap.values()).map((cityAcc) => {
    const dates: DiscoverDateBucket[] = Array.from(cityAcc.dates.values())
      .map((d) => {
        const sortedMarkets = [...d.markets].sort(
          (a, b) => marketTempSortKey(a) - marketTempSortKey(b),
        );
        return {
          date: d.date,
          dateLabel: formatDiscoverDateLabel(d.date, sortedMarkets.length),
          markets: sortedMarkets,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const marketCount = dates.reduce((n, d) => n + d.markets.length, 0);
    return {
      city: cityAcc.city,
      cityLabel: formatDiscoverCityLabel(cityAcc.city, marketCount),
      dates,
    };
  });

  groups.sort((a, b) => {
    const aParis = a.city.toLowerCase() === 'paris';
    const bParis = b.city.toLowerCase() === 'paris';
    if (aParis && !bParis) return -1;
    if (!aParis && bParis) return 1;
    if (a.city === 'Autres') return 1;
    if (b.city === 'Autres') return -1;
    return a.city.localeCompare(b.city);
  });

  return groups;
}
