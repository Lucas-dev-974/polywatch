import {
  fetchGammaMarketsByTagSlug,
  type MarketListItemDto,
} from '../polymarket/market-list.js';
import { parseWeatherQuestion, resolveWeatherDate } from './question-parser.js';
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
  /** Markets grouped by city, for the dropdown UI. */
  byCity: CityMarketGroup[];
}

export async function discoverWeatherMarkets(
  options?: {
    limit?: number;
    offset?: number;
    targetDate?: Date;
    targetDates?: Date[];
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

  function matchesTargetDate(m: MarketListItemDto): boolean {
    if (m.question) {
      const parsed = parseWeatherQuestion(m.question);
      if (parsed && targetMonthDays.has(parsed.dateString)) return true;
    }
    if (m.endDate) {
      const endStr = new Date(m.endDate).toISOString().slice(0, 10);
      if (targetStrs.has(endStr)) return true;
    }
    return false;
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

  // Group all weather markets by city for the UI dropdown.
  // Filter to highest_temp only as requested.
  const byCity = groupMarketsByCity(allWeatherMarkets, 'highest_temp');

  // Sort groups: J+1 (tomorrow) first, J (today) second, then by city name.
  // This keeps the primary discovery goal (J+1 markets) at the top of the UI.
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  byCity.sort((a, b) => {
    const aHasTomorrow = a.markets.some((m) => m.endDate?.startsWith(tomorrowStr));
    const bHasTomorrow = b.markets.some((m) => m.endDate?.startsWith(tomorrowStr));
    if (aHasTomorrow && !bHasTomorrow) return -1;
    if (!aHasTomorrow && bHasTomorrow) return 1;
    if (a.city === 'Autres') return 1;
    if (b.city === 'Autres') return -1;
    return a.city.localeCompare(b.city);
  });

  log.info(
    {
      totalFetched: allItems.length,
      temperatureMarkets: temperatureMarkets.length,
      allWeatherMarkets: allWeatherMarkets.length,
      cityGroups: byCity.length,
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

export type ForecastStatus = 'fresh' | 'stale' | 'unavailable';

export interface ForecastEnrichedCityGroup extends CityMarketGroup {
  /** ISO date string (YYYY-MM-DD) for which the forecast applies. */
  targetDate: string;
  /** Forecast mean temperature in °C. Null when no forecast is available. */
  forecastMean: number | null;
  /** Forecast standard deviation in °C. Null when no forecast is available. */
  forecastStdDev: number | null;
  /** Source status for the displayed forecast. */
  forecastStatus: ForecastStatus;
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
  metricFilter?: 'highest_temp' | 'lowest_temp',
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
