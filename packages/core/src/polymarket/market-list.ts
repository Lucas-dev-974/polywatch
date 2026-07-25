import { getGammaApiUrl } from './apis.js';
import { parseGammaMarketRecord } from './market-metadata.js';
import type { MarketOutcomeToken } from './outcome-tokens.js';
import { buildPolymarketMarketUrl } from './url.js';
import { marketClassifier } from '../market/classifier.js';
import { MarketType } from '../market/market-type.js';

export { marketClassifier } from '../market/classifier.js';

export interface MarketListItemDto {
  conditionId: string;
  question: string | null;
  slug: string | null;
  eventSlug: string | null;
  icon: string | null;
  endDate: string | null;
  /** Start of the trading window (ISO 8601). Prefers Gamma `eventStartTime`. */
  startDate: string | null;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  outcomePrices: { outcome: string; price: number }[];
  /** Binary outcome tokens with dynamic Gamma labels (side0 = tokenIdYes). */
  outcomes: MarketOutcomeToken[];
  acceptingOrders: boolean | null;
  closed: boolean;
  url: string;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
  category: string | null;
  tagSlugs: string[];
  /** Crypto symbol extracted from Up/Down question, e.g. "Bitcoin", "Ethereum". Null for non-crypto markets. */
  cryptoSymbol: string | null;
  /** Interval label extracted from Up/Down question, e.g. "5min", "1h". Null for non-crypto markets. */
  interval: string | null;
  /** Functional category for crypto markets, e.g. "up-down", "above-below", "target-price". Null for non-crypto markets. */
  cryptoCategory: string | null;
  /** Type de marché explicite (standard, crypto_up_down, etc.). Défini par le classifieur centralisé. */
  marketType: MarketType;
}

/**
 * Returns true when a market is still open for trading. Gamma sometimes keeps
 * short-interval markets marked as active for a few minutes after their end
 * date, so we also check endDate, closed and acceptingOrders explicitly.
 */
export function isMarketActive(item: MarketListItemDto, now = Date.now()): boolean {
  if (item.closed) return false;
  if (item.acceptingOrders === false) return false;
  // Market hasn't started yet — don't show it
  if (item.startDate) {
    const start = new Date(item.startDate).getTime();
    if (start > now) return false;
  }
  if (item.endDate) {
    const end = new Date(item.endDate).getTime();
    if (end <= now) return false;
  }
  return true;
}

export interface FetchGammaMarketsKeysetOptions {
  limit?: number;
  afterCursor?: string;
  order?: string;
  ascending?: boolean;
  closed?: boolean;
  /** Filter by active (live) status. When true, only currently active markets are returned. */
  active?: boolean;
  tagId?: string;
  /** Use tag_slug directly instead of resolving tagId. Often faster for category filters. */
  tagSlug?: string;
}

export interface FetchGammaMarketsByTagSlugOptions {
  tagSlug: string;
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  closed?: boolean;
  /** Filter by active (live) status. When true, only currently active markets are returned. */
  active?: boolean;
  /**
   * When true, return all markets from the fetched events instead of capping
   * to `limit`. Useful for discovery algorithms that need every market under a tag.
   */
  includeAllMarkets?: boolean;
}

export interface GammaMarketsKeysetResult {
  items: MarketListItemDto[];
  nextCursor: string | null;
}

function extractConditionId(raw: Record<string, unknown>): string | null {
  if (typeof raw.conditionId === 'string') return raw.conditionId;
  if (typeof raw.condition_id === 'string') return raw.condition_id;
  return null;
}

/** Crypto symbols we want to recognize in market questions. Ordered by priority. */
export const CRYPTO_SYMBOLS = [
  'Bitcoin',
  'Ethereum',
  'Solana',
  'XRP',
  'Dogecoin',
  'Cardano',
  'Chainlink',
  'Polygon',
  'Litecoin',
  'Polkadot',
  'Avalanche',
  'Uniswap',
  'Shiba Inu',
];

const CRYPTO_SYMBOL_PATTERN = new RegExp(
  `\\b(${CRYPTO_SYMBOLS.map((s) => s.replace(/\s/g, '\\s+')).join('|')})\\b`,
  'i',
);

/**
 * Extract a known crypto symbol from any market question.
 * Returns null if none of the recognized symbols is found.
 */
export function extractCryptoSymbolFromQuestion(
  question: string | null,
): string | null {
  if (!question) return null;
  const match = question.match(CRYPTO_SYMBOL_PATTERN);
  if (!match) return null;
  // Preserve original casing from the recognized symbol list.
  const found = match[1]!.toLowerCase();
  return CRYPTO_SYMBOLS.find((s) => s.toLowerCase() === found) ?? null;
}

/**
 * Format a duration in minutes into a compact human-readable interval label.
 * Examples: 5 -> "5m", 60 -> "1h", 1440 -> "1d".
 */
export function formatIntervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function parseTime12h(str: string): number | null {
  // Accept both "4:50 PM" and the space-less "4:50PM" form.
  const match = str.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const ampm = match[3]!.toUpperCase();
  let hours = h;
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return hours * 60 + m;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Extract the start time of a market from its question text.
 * Polymarket questions use Eastern Time (ET).
 * Example: "Bitcoin Up or Down - June 25, 4:50AM-4:55AM" → ISO string for June 25, 4:50 AM ET
 * Returns null if no time window is found in the question.
 */
export function extractStartDateFromQuestion(question: string | null): string | null {
  if (!question) return null;

  // Match: "June 25, 4:50AM-4:55AM" or "June 25, 4:50 AM - 4:55 AM"
  const dateTimePattern =
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]/i;
  const match = question.match(dateTimePattern);
  if (!match) return null;

  const monthName = match[1]!;
  const day = parseInt(match[2]!, 10);
  const timeStr = match[3]!;

  const monthIndex = MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === monthName.toLowerCase(),
  );
  if (monthIndex < 0) return null;

  const startMin = parseTime12h(timeStr);
  if (startMin === null) return null;

  const hours = Math.floor(startMin / 60);
  const minutes = startMin % 60;

  // Use current year (these are short-term markets)
  const year = new Date().getUTCFullYear();

  // Determine the UTC offset for America/New_York on this date (handles DST)
  // Create a reference timestamp at noon UTC on the target date to get the offset
  const refDate = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(refDate);

  const offsetStr = offsetParts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const offsetMatch = offsetStr.match(/GMT([+-]\d{1,2}):?(\d{2})?/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1]!, 10) : -5;
  const offsetMinutes = offsetMatch && offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0;
  const totalOffsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000;

  // ET time in UTC = ET components as if UTC - offset
  // If ET is UTC-4 (EDT), 4:50 AM ET = 4:50 + 4:00 = 8:50 UTC
  const utcMs = Date.UTC(year, monthIndex, day, hours, minutes, 0, 0) - totalOffsetMs;
  return new Date(utcMs).toISOString();
}

/**
 * Resolve the trading-window start from Gamma metadata.
 * Prefers `eventStartTime` (canonical UTC); falls back to question parsing.
 */
export function resolveMarketStartDate(
  eventStartTime: string | null | undefined,
  question: string | null,
): string | null {
  if (typeof eventStartTime === 'string' && eventStartTime.trim()) {
    const parsed = Date.parse(eventStartTime);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return extractStartDateFromQuestion(question);
}

function extractIntervalFromTimeWindow(question: string): number | null {
  const timeWindowPattern =
    /(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)/i;
  const match = question.match(timeWindowPattern);
  if (!match) return null;

  const startMin = parseTime12h(match[1]!);
  const endMin = parseTime12h(match[2]!);
  if (startMin === null || endMin === null) return null;
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

function extractIntervalFromExplicitLabel(question: string): number | null {
  const minMatch = question.match(/\b(\d+)\s*(?:min|minute|minutes|m)\b/i);
  if (minMatch) return Number(minMatch[1]);

  const hourMatch = question.match(/\b(\d+)\s*(?:hour|hours|hr|h)\b/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  return null;
}

/** Map Polymarket recurrence tag slugs to normalized interval filter values. */
function extractIntervalFromTagSlugs(tagSlugs: string[]): string | null {
  for (const slug of tagSlugs) {
    const upper = slug.toUpperCase();
    if (upper === '5M') return '5m';
    if (upper === '15M') return '15m';
    if (upper === '1H') return '1h';
    if (upper === '4H') return '4h';
    const lower = slug.toLowerCase();
    if (lower === 'daily' || lower === 'today') return '1d';
    if (lower === 'weekly') return '1w';
    if (lower === 'monthly') return '1mo';
    if (lower === 'yearly') return '1y';
  }
  return null;
}

function isCryptoTaggedMarket(tagSlugs: string[]): boolean {
  return tagSlugs.includes('crypto') || tagSlugs.includes('up-or-down');
}

/**
 * Parses a crypto Up/Down question to extract the crypto symbol and interval label.
 * Supports multiple question shapes:
 *   - "Bitcoin Up or Down - June 23, 4:50AM-4:55AM"
 *   - "Bitcoin Up or Down on June 23?"
 *   - "Bitcoin Up or Down - 5 min window"
 * Returns null if the question is not a recognized Up/Down crypto market.
 */
export function parseCryptoUpDownQuestion(
  question: string | null,
): { cryptoSymbol: string; interval: string } | null {
  if (!question) return null;

  const upDownPattern =
    /^([\w][\w\s]*?)\s+(?:up or down|up\/down|up-down)\b/i;
  const match = question.match(upDownPattern);
  if (!match) return null;

  const rawSymbol = match[1]!.trim();
  const cryptoSymbol =
    extractCryptoSymbolFromQuestion(question) ??
    CRYPTO_SYMBOLS.find((s) => s.toLowerCase() === rawSymbol.toLowerCase()) ??
    rawSymbol;

  // Try to extract interval from an explicit time window first, then from text labels.
  const diff =
    extractIntervalFromTimeWindow(question) ??
    extractIntervalFromExplicitLabel(question);

  if (diff == null || diff <= 0) {
    // No interval information in the question: still return the symbol with a generic label.
    return { cryptoSymbol, interval: '—' };
  }

  return { cryptoSymbol, interval: formatIntervalLabel(diff) };
}

function extractMarketCryptoSymbol(
  question: string | null,
): { cryptoSymbol: string; interval: string | null } | null {
  // Prefer the Up/Down parser because it also gives us the interval.
  const updown = parseCryptoUpDownQuestion(question);
  if (updown) {
    return {
      cryptoSymbol: updown.cryptoSymbol,
      interval: updown.interval === '—' ? null : updown.interval,
    };
  }

  // Fall back to a generic question scan for known crypto names.
  const cryptoSymbol = extractCryptoSymbolFromQuestion(question);
  if (!cryptoSymbol) return null;
  return { cryptoSymbol, interval: null };
}

/** Classify a crypto market question into a functional category. */
function classifyCryptoCategory(question: string | null): string | null {
  return marketClassifier.classifyCryptoCategory(question);
}

/** Case-insensitive comparison for crypto symbols from rules vs Gamma questions. */
export function cryptoSymbolsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isUpDownCryptoMarket(
  item: Pick<MarketListItemDto, 'cryptoCategory' | 'question'>,
): boolean {
  if (item.cryptoCategory === 'up-down') return true;
  if (!item.question) return false;
  return classifyCryptoCategory(item.question) === 'up-down';
}

/**
 * Map a raw market record to a list item, swallowing any parsing error so a
 * single malformed market never breaks the whole list.
 */
function safeMapRawToListItem(
  raw: Record<string, unknown>,
): MarketListItemDto | null {
  try {
    return mapRawToListItem(raw);
  } catch {
    return null;
  }
}

function mapRawToListItem(raw: Record<string, unknown>): MarketListItemDto | null {
  const conditionId = extractConditionId(raw);
  if (!conditionId) return null;

  const market = parseGammaMarketRecord(raw);
  const crypto = extractMarketCryptoSymbol(market.question);
  const startDate = resolveMarketStartDate(market.eventStartTime, market.question);
  const cryptoCategory = crypto?.cryptoSymbol
    ? classifyCryptoCategory(market.question)
    : null;
  const tagInterval = isCryptoTaggedMarket(market.tagSlugs)
    ? extractIntervalFromTagSlugs(market.tagSlugs)
    : null;
  const marketType = marketClassifier.classify({
    question: market.question,
    category: market.category,
    tagSlugs: market.tagSlugs,
  });
  return {
    conditionId,
    question: market.question,
    slug: market.slug,
    eventSlug: market.eventSlug,
    icon: market.icon,
    endDate: market.endDate,
    startDate,
    volume: market.volume ?? null,
    volume24hr: market.volume24hr ?? null,
    liquidityClob: market.liquidityClob ?? null,
    outcomePrices: market.outcomePricesParsed,
    outcomes: market.outcomeTokens,
    acceptingOrders: market.acceptingOrders,
    closed: market.closed,
    url: buildPolymarketMarketUrl(market.eventSlug, market.slug, conditionId),
    tokenIdYes: market.tokenIdYes,
    tokenIdNo: market.tokenIdNo,
    category: market.category,
    tagSlugs: market.tagSlugs,
    cryptoSymbol: crypto?.cryptoSymbol ?? null,
    interval: crypto?.interval ?? tagInterval,
    cryptoCategory,
    marketType,
  };
}

/** Polymarket Gamma tag slugs used to fetch markets for each interval filter. */
export const INTERVAL_TAG_SLUG: Record<string, string> = {
  '5m': '5M',
  '15m': '15M',
  '1h': '1H',
  '4h': '4H',
  '1d': 'daily',
  '1w': 'weekly',
  '1mo': 'monthly',
  '1y': 'yearly',
};

function flattenEventMarkets(
  events: Record<string, unknown>[],
  includeClosed = false,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const markets = Array.isArray(event.markets) ? event.markets : [];
    for (const market of markets) {
      if (typeof market !== 'object' || market === null) continue;
      const marketRecord = market as Record<string, unknown>;
      // Events endpoint can return resolved/closed markets nested inside an
      // active event; keep only the ones the caller asked for.
      if (!includeClosed && (marketRecord.active === false || marketRecord.closed === true)) {
        continue;
      }
      result.push({ ...marketRecord, events: [event] });
    }
  }
  return result;
}

export async function fetchGammaMarketsByTagSlug(
  options: FetchGammaMarketsByTagSlugOptions,
): Promise<GammaMarketsKeysetResult> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const offset = Math.max(0, Number(options.offset ?? 0));

  const params = new URLSearchParams({
    tag_slug: options.tagSlug,
    closed: String(options.closed ?? false),
    limit: String(limit),
    offset: String(offset),
  });
  if (options.active !== undefined) {
    params.set('active', String(options.active));
  }
  if (options.order) {
    params.set('order', options.order);
  }
  if (options.ascending !== undefined) {
    params.set('ascending', String(options.ascending));
  }

  const res = await fetch(`${getGammaApiUrl()}/events?${params}`);
  if (!res.ok) {
    throw new Error(`gamma_events_tag_slug_error:${res.status}`);
  }

  const events = (await res.json()) as Record<string, unknown>[];
  let markets = flattenEventMarkets(events, options.closed ?? false);

  // The /events endpoint sorts events, not individual markets. Re-sort markets
  // by the requested metric so pagination behaves consistently with the UI.
  const orderField = options.order ?? 'volume24hr';
  const ascending = options.ascending ?? false;
  markets.sort((a, b) => {
    const aVal = Number(a[orderField] ?? 0);
    const bVal = Number(b[orderField] ?? 0);
    const diff = aVal - bVal;
    return ascending ? diff : -diff;
  });

  // Events endpoint uses numeric offset pagination. Return the next offset as
  // the opaque cursor so the existing pagination UI keeps working.
  const hasMoreEvents = events.length >= limit;
  const nextCursor = hasMoreEvents ? String(offset + events.length) : null;

  if (options.includeAllMarkets) {
    const items = markets
      .map(safeMapRawToListItem)
      .filter((item): item is MarketListItemDto => item !== null);
    return { items, nextCursor };
  }

  // Cap results to the requested page size so the frontend receives a normal
  // paginated list even though each event can contain many markets.
  const page = markets.slice(0, limit);
  const items = page
    .map(safeMapRawToListItem)
    .filter((item): item is MarketListItemDto => item !== null);

  return {
    items,
    nextCursor,
  };
}

export async function fetchGammaMarketsKeyset(
  options: FetchGammaMarketsKeysetOptions = {},
): Promise<GammaMarketsKeysetResult> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const params = new URLSearchParams({
    limit: String(limit),
    closed: String(options.closed ?? false),
  });

  if (options.active !== undefined) {
    params.set('active', String(options.active));
  }

  if (options.afterCursor) {
    params.set('after_cursor', options.afterCursor);
  }
  if (options.order) {
    params.set('order', options.order);
  }
  if (options.ascending !== undefined) {
    params.set('ascending', String(options.ascending));
  }
  if (options.tagSlug) {
    params.append('tag_slug', options.tagSlug);
    params.set('related_tags', 'true');
  } else if (options.tagId) {
    params.append('tag_id', options.tagId);
    params.set('related_tags', 'true');
  }

  const res = await fetch(`${getGammaApiUrl()}/markets/keyset?${params}`);
  if (!res.ok) {
    throw new Error(`gamma_markets_keyset_error:${res.status}`);
  }

  const body = (await res.json()) as {
    markets?: Record<string, unknown>[];
    next_cursor?: string;
  };

  const markets = Array.isArray(body.markets) ? body.markets : [];
  const items = markets
    .map(safeMapRawToListItem)
    .filter((item): item is MarketListItemDto => item !== null);

  return {
    items,
    nextCursor: typeof body.next_cursor === 'string' ? body.next_cursor : null,
  };
}

/** Polymarket short-interval Up/Down event slugs use these asset prefixes. */
export const CRYPTO_ASSET_SLUG: Record<string, string> = {
  bitcoin: 'btc',
  ethereum: 'eth',
  solana: 'sol',
  xrp: 'xrp',
  dogecoin: 'doge',
  cardano: 'ada',
  chainlink: 'link',
  polygon: 'matic',
  litecoin: 'ltc',
  polkadot: 'dot',
  avalanche: 'avax',
  uniswap: 'uni',
  'shiba inu': 'shib',
};

/** Map a crypto symbol (e.g. "Bitcoin") to the Polymarket slug asset prefix. */
export function resolveCryptoAssetSlug(cryptoSymbol: string): string | null {
  const key = cryptoSymbol.trim().toLowerCase();
  return CRYPTO_ASSET_SLUG[key] ?? null;
}

/**
 * Fetch a single Up/Down market by its deterministic Polymarket event slug.
 * Returns null when the slug is unknown (404) or the payload cannot be mapped.
 */
export async function fetchGammaMarketByEventSlug(
  slug: string,
): Promise<MarketListItemDto | null> {
  try {
    const res = await fetch(
      `${getGammaApiUrl()}/events/slug/${encodeURIComponent(slug)}`,
    );
    if (!res.ok) return null;

    const event = (await res.json()) as Record<string, unknown>;
    const markets = Array.isArray(event.markets) ? event.markets : [];
    const first = markets[0];
    if (typeof first !== 'object' || first === null) return null;

    return safeMapRawToListItem({
      ...(first as Record<string, unknown>),
      events: [event],
    });
  } catch {
    return null;
  }
}

export type { MarketPercentUpdate } from '../types/index.js';
