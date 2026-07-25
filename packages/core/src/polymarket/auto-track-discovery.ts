import type { GammaMarket } from './market-metadata.js';
import {
  cryptoSymbolsEqual,
  fetchGammaMarketByEventSlug,
  fetchGammaMarketsByTagSlug,
  INTERVAL_TAG_SLUG,
  parseCryptoUpDownQuestion,
  resolveCryptoAssetSlug,
  resolveMarketStartDate,
  type MarketListItemDto,
} from './market-list.js';
import { MarketType } from '../market/market-type.js';

export const AUTO_TRACK_FETCH_PAGE_SIZE = 100;
export const AUTO_TRACK_MAX_PAGES = 6;
export const AUTO_TRACK_SYNC_MIN_INTERVAL_MS = 10_000;
/** Throttle for Gamma pagination when resolving upcoming auto-track windows. */
export const FUTURE_MARKETS_SYNC_MIN_INTERVAL_MS = 30_000;

/** Janitor cadence when any enabled rule uses a short window (5m / 15m). */
export const SHORT_INTERVAL_JANITOR_MS = 30_000;
export const DEFAULT_JANITOR_MS = 60_000;

const SHORT_INTERVALS = new Set(['5m', '15m']);

/** Window length in seconds for slug-based Up/Down discovery. */
const SHORT_INTERVAL_WINDOW_SEC: Record<'5m' | '15m', number> = {
  '5m': 300,
  '15m': 900,
};

export function isShortRecurringInterval(interval: string): boolean {
  return SHORT_INTERVALS.has(interval);
}

/** Build the deterministic Polymarket event slug for a short-interval Up/Down market. */
export function buildUpDownEventSlug(
  cryptoSymbol: string,
  interval: '5m' | '15m',
  windowStartSec: number,
): string | null {
  const asset = resolveCryptoAssetSlug(cryptoSymbol);
  if (!asset) return null;
  return `${asset}-updown-${interval}-${windowStartSec}`;
}

function floorWindowStartSec(interval: '5m' | '15m', nowSec = Math.floor(Date.now() / 1000)): number {
  const windowSec = SHORT_INTERVAL_WINDOW_SEC[interval];
  return Math.floor(nowSec / windowSec) * windowSec;
}

async function fetchMarketByUpDownSlug(
  cryptoSymbol: string,
  interval: '5m' | '15m',
  windowStartSec: number,
): Promise<MarketListItemDto | null> {
  const slug = buildUpDownEventSlug(cryptoSymbol, interval, windowStartSec);
  if (!slug) return null;

  const item = await fetchGammaMarketByEventSlug(slug);
  if (!item) return null;
  if (!cryptoSymbolsEqual(item.cryptoSymbol, cryptoSymbol)) return null;
  if (item.marketType !== MarketType.CRYPTO_UP_DOWN) return null;
  return item;
}

/**
 * Discover short-interval markets via deterministic slugs (current ± adjacent windows).
 * Falls back to an empty list when the asset slug is unknown.
 */
async function fetchShortIntervalSlugCandidates(
  cryptoSymbol: string,
  interval: '5m' | '15m',
  options?: { offsets?: number[] },
): Promise<MarketListItemDto[]> {
  const windowSec = SHORT_INTERVAL_WINDOW_SEC[interval];
  const base = floorWindowStartSec(interval);
  const offsets = options?.offsets ?? [-windowSec, 0, windowSec, 2 * windowSec];

  const candidates: MarketListItemDto[] = [];
  const seen = new Set<string>();

  for (const offset of offsets) {
    const item = await fetchMarketByUpDownSlug(cryptoSymbol, interval, base + offset);
    if (!item || seen.has(item.conditionId)) continue;
    seen.add(item.conditionId);
    candidates.push(item);
  }

  return candidates;
}

async function discoverBestAutoTrackMarketBySlug(
  cryptoSymbol: string,
  interval: '5m' | '15m',
  options?: { requireLive?: boolean },
): Promise<MarketListItemDto | null> {
  const windowSec = SHORT_INTERVAL_WINDOW_SEC[interval];
  const base = floorWindowStartSec(interval);
  const offsets = options?.requireLive
    ? [0, -windowSec]
    : [0, -windowSec, windowSec];

  const candidates = await fetchShortIntervalSlugCandidates(cryptoSymbol, interval, {
    offsets,
  });
  if (candidates.length === 0) return null;

  return pickBestAutoTrackMarketForSymbol(candidates, cryptoSymbol, Date.now(), {
    requireLive: options?.requireLive,
  });
}

async function discoverBestFutureAutoTrackMarketBySlug(
  cryptoSymbol: string,
  interval: '5m' | '15m',
  excludeConditionId?: string | null,
): Promise<MarketListItemDto | null> {
  const windowSec = SHORT_INTERVAL_WINDOW_SEC[interval];
  const base = floorWindowStartSec(interval);
  const candidates = await fetchShortIntervalSlugCandidates(cryptoSymbol, interval, {
    offsets: [windowSec, 2 * windowSec, 3 * windowSec],
  });
  if (candidates.length === 0) return null;

  return pickBestFutureAutoTrackMarketForSymbol(
    candidates,
    cryptoSymbol,
    excludeConditionId,
  );
}

export function resolveAutoTrackTagSlug(interval: string): string | null {
  return INTERVAL_TAG_SLUG[interval] ?? null;
}

export function resolveMarketJanitorIntervalMs(
  rules: { interval: string }[],
): number {
  if (rules.some((rule) => isShortRecurringInterval(rule.interval))) {
    return SHORT_INTERVAL_JANITOR_MS;
  }
  return DEFAULT_JANITOR_MS;
}

/** True when a market has not ended yet and still accepts orders. */
export function isMarketNotExpired(
  item: Pick<MarketListItemDto, 'closed' | 'acceptingOrders' | 'endDate'>,
  now = Date.now(),
): boolean {
  if (item.closed) return false;
  if (item.acceptingOrders === false) return false;
  if (!item.endDate) return true;
  return new Date(item.endDate).getTime() > now;
}

/** True when a market is inside its live trading window. */
export function isMarketLiveNow(
  item: Pick<MarketListItemDto, 'closed' | 'acceptingOrders' | 'startDate' | 'endDate'>,
  now = Date.now(),
): boolean {
  if (!isMarketNotExpired(item, now)) return false;
  if (!item.startDate) return true;
  return new Date(item.startDate).getTime() <= now;
}

/** True when a market has not started yet but is still open for the upcoming window. */
export function isMarketUpcoming(
  item: Pick<MarketListItemDto, 'closed' | 'acceptingOrders' | 'startDate' | 'endDate'>,
  now = Date.now(),
): boolean {
  if (!isMarketNotExpired(item, now)) return false;
  if (!item.startDate) return false;
  return new Date(item.startDate).getTime() > now;
}

export function isGammaMarketResolved(gamma: GammaMarket, now = Date.now()): boolean {
  if (gamma.closed || gamma.resolved) return true;
  if (gamma.endDate && new Date(gamma.endDate).getTime() <= now) return true;
  return false;
}

export function isGammaMarketLiveNow(
  gamma: Pick<
    GammaMarket,
    'question' | 'endDate' | 'closed' | 'acceptingOrders' | 'resolved' | 'eventStartTime'
  >,
  now = Date.now(),
): boolean {
  return isMarketLiveNow(
    {
      endDate: gamma.endDate,
      closed: gamma.closed ?? false,
      acceptingOrders: gamma.acceptingOrders,
      startDate: resolveMarketStartDate(gamma.eventStartTime, gamma.question),
    },
    now,
  );
}

export function isGammaMarketValidForAutoTrack(
  gamma: GammaMarket,
  expectedSymbol: string,
  options?: { requireLive?: boolean },
): boolean {
  if (!isMarketNotExpired(gamma, Date.now())) return false;

  const parsed = parseCryptoUpDownQuestion(gamma.question);
  const symbol = parsed?.cryptoSymbol ?? null;
  if (!cryptoSymbolsEqual(symbol, expectedSymbol)) return false;

  if (options?.requireLive && !isGammaMarketLiveNow(gamma)) {
    return false;
  }

  return true;
}

/**
 * Pick the best auto-track market for a symbol.
 * Prefers the live window; otherwise the nearest upcoming one.
 */
export function pickBestAutoTrackMarket(
  items: MarketListItemDto[],
  now = Date.now(),
  options?: { requireLive?: boolean },
): MarketListItemDto | null {
  const eligible = items.filter((item) => isMarketNotExpired(item, now));
  if (eligible.length === 0) return null;

  const live = eligible.filter((item) => isMarketLiveNow(item, now));
  if (options?.requireLive && live.length === 0) return null;

  const pool = live.length > 0 ? live : eligible;

  pool.sort((a, b) => {
    const aStart = a.startDate ? new Date(a.startDate).getTime() : Infinity;
    const bStart = b.startDate ? new Date(b.startDate).getTime() : Infinity;
    if (live.length > 0) {
      if (aStart !== bStart) return bStart - aStart;
    } else if (aStart !== bStart) {
      return aStart - bStart;
    }
    return (b.volume24hr ?? 0) - (a.volume24hr ?? 0);
  });

  return pool[0] ?? null;
}

/**
 * Pick the nearest upcoming auto-track market for a symbol.
 * Skips the current live selection when `excludeConditionId` is set.
 */
export function pickBestFutureAutoTrackMarket(
  items: MarketListItemDto[],
  excludeConditionId?: string | null,
  now = Date.now(),
): MarketListItemDto | null {
  const upcoming = items.filter(
    (item) =>
      isMarketUpcoming(item, now) &&
      item.conditionId !== excludeConditionId,
  );
  if (upcoming.length === 0) return null;

  upcoming.sort((a, b) => {
    const aStart = a.startDate ? new Date(a.startDate).getTime() : Infinity;
    const bStart = b.startDate ? new Date(b.startDate).getTime() : Infinity;
    if (aStart !== bStart) return aStart - bStart;
    return (b.volume24hr ?? 0) - (a.volume24hr ?? 0);
  });

  return upcoming[0] ?? null;
}

function isUpDownCandidate(item: MarketListItemDto): boolean {
  return item.marketType === MarketType.CRYPTO_UP_DOWN;
}

function allSymbolsHaveLiveCandidates(
  candidates: MarketListItemDto[],
  cryptoSymbols: string[],
  now: number,
): boolean {
  if (cryptoSymbols.length === 0) return false;
  return cryptoSymbols.every((symbol) =>
    candidates.some(
      (item) =>
        cryptoSymbolsEqual(item.cryptoSymbol, symbol) &&
        isMarketLiveNow(item, now),
    ),
  );
}

function allSymbolsHaveFutureCandidates(
  candidates: MarketListItemDto[],
  cryptoSymbols: string[],
  liveConditionIdsBySymbol: Map<string, string | null>,
  now: number,
): boolean {
  if (cryptoSymbols.length === 0) return false;
  return cryptoSymbols.every((symbol) => {
    const liveId = liveConditionIdsBySymbol.get(symbol) ?? null;
    return candidates.some(
      (item) =>
        cryptoSymbolsEqual(item.cryptoSymbol, symbol) &&
        isMarketUpcoming(item, now) &&
        item.conditionId !== liveId,
    );
  });
}

/**
 * Paginate Gamma results for a tag slug. When `cryptoSymbols` is provided,
 * pagination stops once every symbol has a live Up/Down candidate.
 */
export async function fetchAutoTrackCandidatesForTagSlug(options: {
  tagSlug: string;
  cryptoSymbols?: string[];
  liveConditionIdsBySymbol?: Map<string, string | null>;
  maxPages?: number;
}): Promise<MarketListItemDto[]> {
  const maxPages = options.maxPages ?? AUTO_TRACK_MAX_PAGES;
  const targetSymbols = options.cryptoSymbols ?? [];
  const liveBySymbol = options.liveConditionIdsBySymbol ?? new Map();
  const matching: MarketListItemDto[] = [];
  let offset = 0;
  const now = Date.now();

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchGammaMarketsByTagSlug({
      tagSlug: options.tagSlug,
      limit: AUTO_TRACK_FETCH_PAGE_SIZE,
      offset,
      closed: false,
      order: 'volume24hr',
    });

    for (const item of result.items) {
      if (!isUpDownCandidate(item)) continue;
      if (
        targetSymbols.length > 0 &&
        !targetSymbols.some((symbol) => cryptoSymbolsEqual(item.cryptoSymbol, symbol))
      ) {
        continue;
      }
      matching.push(item);
    }

    if (
      targetSymbols.length > 0 &&
      allSymbolsHaveLiveCandidates(matching, targetSymbols, now) &&
      allSymbolsHaveFutureCandidates(matching, targetSymbols, liveBySymbol, now)
    ) {
      break;
    }

    if (!result.nextCursor) break;
    offset = Number(result.nextCursor);
  }

  return matching;
}

/** Paginate Gamma tag results for one symbol. */
export async function fetchAutoTrackCandidatesForSymbol(options: {
  tagSlug: string;
  cryptoSymbol: string;
  interval?: string;
  maxPages?: number;
}): Promise<MarketListItemDto[]> {
  if (
    options.interval &&
    isShortRecurringInterval(options.interval) &&
    (options.interval === '5m' || options.interval === '15m')
  ) {
    return fetchShortIntervalSlugCandidates(
      options.cryptoSymbol,
      options.interval,
    );
  }

  return fetchAutoTrackCandidatesForTagSlug({
    tagSlug: options.tagSlug,
    cryptoSymbols: [options.cryptoSymbol],
    maxPages: options.maxPages,
  });
}

export function pickBestAutoTrackMarketForSymbol(
  candidates: MarketListItemDto[],
  cryptoSymbol: string,
  now = Date.now(),
  options?: { requireLive?: boolean },
): MarketListItemDto | null {
  const filtered = candidates.filter((item) =>
    cryptoSymbolsEqual(item.cryptoSymbol, cryptoSymbol),
  );
  return pickBestAutoTrackMarket(filtered, now, options);
}

export function pickBestFutureAutoTrackMarketForSymbol(
  candidates: MarketListItemDto[],
  cryptoSymbol: string,
  excludeConditionId?: string | null,
  now = Date.now(),
): MarketListItemDto | null {
  const filtered = candidates.filter((item) =>
    cryptoSymbolsEqual(item.cryptoSymbol, cryptoSymbol),
  );
  return pickBestFutureAutoTrackMarket(filtered, excludeConditionId, now);
}

/** Discover the best Up/Down market for an auto-track rule. */
export async function discoverBestAutoTrackMarket(
  cryptoSymbol: string,
  interval: string,
  options?: { requireLive?: boolean },
): Promise<MarketListItemDto | null> {
  const requireLive = options?.requireLive ?? isShortRecurringInterval(interval);

  if (interval === '5m' || interval === '15m') {
    const bySlug = await discoverBestAutoTrackMarketBySlug(
      cryptoSymbol,
      interval,
      { requireLive },
    );
    if (bySlug) return bySlug;
  }

  const tagSlug = resolveAutoTrackTagSlug(interval);
  if (!tagSlug) return null;

  const candidates = await fetchAutoTrackCandidatesForSymbol({
    tagSlug,
    cryptoSymbol,
    interval,
  });
  return pickBestAutoTrackMarketForSymbol(candidates, cryptoSymbol, Date.now(), {
    requireLive,
  });
}

/** Discover the nearest upcoming Up/Down market for an auto-track rule. */
export async function discoverBestFutureAutoTrackMarket(
  cryptoSymbol: string,
  interval: string,
  excludeConditionId?: string | null,
): Promise<MarketListItemDto | null> {
  if (interval === '5m' || interval === '15m') {
    const bySlug = await discoverBestFutureAutoTrackMarketBySlug(
      cryptoSymbol,
      interval,
      excludeConditionId,
    );
    if (bySlug) return bySlug;
  }

  const tagSlug = resolveAutoTrackTagSlug(interval);
  if (!tagSlug) return null;

  const liveBySymbol = new Map<string, string | null>([
    [cryptoSymbol, excludeConditionId ?? null],
  ]);
  const candidates = await fetchAutoTrackCandidatesForTagSlug({
    tagSlug,
    cryptoSymbols: [cryptoSymbol],
    liveConditionIdsBySymbol: liveBySymbol,
  });
  return pickBestFutureAutoTrackMarketForSymbol(
    candidates,
    cryptoSymbol,
    excludeConditionId,
  );
}

/** Batch-fetch candidates for multiple rules sharing the same interval tag. */
export async function fetchAutoTrackCandidatesForRules(
  rules: { cryptoSymbol: string; interval: string }[],
  liveConditionIdsByRule?: Map<string, string | null>,
): Promise<Map<string, MarketListItemDto[]>> {
  const byTagSlug = new Map<
    string,
    { interval: string; symbols: string[]; liveBySymbol: Map<string, string | null> }
  >();

  for (const rule of rules) {
    const tagSlug = resolveAutoTrackTagSlug(rule.interval);
    if (!tagSlug) continue;

    const ruleKey = `${rule.cryptoSymbol}:${rule.interval}`;
    const entry = byTagSlug.get(tagSlug) ?? {
      interval: rule.interval,
      symbols: [],
      liveBySymbol: new Map<string, string | null>(),
    };
    if (!entry.symbols.some((s) => cryptoSymbolsEqual(s, rule.cryptoSymbol))) {
      entry.symbols.push(rule.cryptoSymbol);
    }
    if (liveConditionIdsByRule?.has(ruleKey)) {
      entry.liveBySymbol.set(
        rule.cryptoSymbol,
        liveConditionIdsByRule.get(ruleKey) ?? null,
      );
    }
    byTagSlug.set(tagSlug, entry);
  }

  const result = new Map<string, MarketListItemDto[]>();
  for (const [tagSlug, { interval, symbols, liveBySymbol }] of byTagSlug.entries()) {
    if (interval === '5m' || interval === '15m') {
      const merged: MarketListItemDto[] = [];
      const seen = new Set<string>();
      for (const symbol of symbols) {
        const slugCandidates = await fetchShortIntervalSlugCandidates(
          symbol,
          interval,
        );
        for (const item of slugCandidates) {
          if (seen.has(item.conditionId)) continue;
          seen.add(item.conditionId);
          merged.push(item);
        }
      }
      result.set(interval, merged);
      continue;
    }

    const candidates = await fetchAutoTrackCandidatesForTagSlug({
      tagSlug,
      cryptoSymbols: symbols,
      liveConditionIdsBySymbol: liveBySymbol,
    });
    result.set(interval, candidates);
  }

  return result;
}
