import { enrichGammaMarketTags, parseTagSlugsFromGammaRaw } from '../market/tags.js';
import { getClobApiUrl, getGammaApiUrl } from './apis.js';
import {
  mapBinaryTokenSlots,
  outcomesFromPairsWithSlots,
  type MarketOutcomeToken,
} from './outcome-tokens.js';

export interface GammaMarket {
  question: string | null;
  slug: string | null;
  /** Slug of the parent event page on polymarket.com (more stable than market slug for URLs). */
  eventSlug: string | null;
  endDate: string | null;
  /** Trading-window start from Gamma (`eventStartTime`), ISO UTC. */
  eventStartTime: string | null;
  negRisk: boolean;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
  /** Platform fee rate (`fd.r` from /clob-markets). */
  feeRate: number;
  /** Fee curve exponent (`fd.e` from /clob-markets). */
  feeExponent: number;
  active: boolean;
  resolved: boolean;
  closed: boolean;
  /** CLOB/Gamma: whether the market still accepts orders. */
  acceptingOrders: boolean | null;
  /** Token id whose payoff is 1 once the market is resolved (null while unknown). */
  winningTokenId: string | null;
  category: string | null;
  tagSlugs: string[];
  volume?: number;
  volume24hr?: number;
  liquidityClob?: number;
  outcomePricesParsed: { outcome: string; price: number }[];
  /** Resolved outcome labels aligned with tokenIdYes (side0) / tokenIdNo (side1). */
  outcomeTokens: MarketOutcomeToken[];
  description: string | null;
  icon: string | null;
}

function parseBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

// Resolved binary markets report the winner with a payoff price of 1.
const WINNING_PRICE_THRESHOLD = 0.99;

function determineWinnerFromPrices(
  tokenIds: string[] | undefined,
  outcomePrices: string[] | undefined,
): string | null {
  if (!tokenIds || !outcomePrices) return null;
  if (tokenIds.length !== outcomePrices.length) return null;
  const winnerIndex = outcomePrices.findIndex(
    (price) => Number(price) >= WINNING_PRICE_THRESHOLD,
  );
  return winnerIndex >= 0 ? tokenIds[winnerIndex] : null;
}

function determineWinningTokenFromClobTokens(
  tokens: Record<string, unknown>[],
): string | null {
  for (const token of tokens) {
    const tokenId = typeof token.token_id === 'string' ? token.token_id : null;
    if (!tokenId) continue;
    if (token.winner === true || Number(token.price) >= WINNING_PRICE_THRESHOLD) {
      return tokenId;
    }
  }
  return null;
}

function parseJsonStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function buildGammaOutcomeFields(
  pairs: { outcome: string; tokenId: string }[],
): Pick<GammaMarket, 'tokenIdYes' | 'tokenIdNo' | 'outcomeTokens'> {
  const { tokenIdYes, tokenIdNo } = mapBinaryTokenSlots(pairs);
  const outcomeTokens =
    tokenIdYes && tokenIdNo
      ? outcomesFromPairsWithSlots(pairs, tokenIdYes, tokenIdNo)
      : [];
  return { tokenIdYes, tokenIdNo, outcomeTokens };
}

function matchesConditionId(
  record: Record<string, unknown>,
  conditionId: string,
): boolean {
  const id =
    typeof record.conditionId === 'string'
      ? record.conditionId
      : typeof record.condition_id === 'string'
        ? record.condition_id
        : null;
  return id?.toLowerCase() === conditionId.toLowerCase();
}

function findMarketByConditionId(
  markets: Record<string, unknown>[],
  conditionId: string,
): Record<string, unknown> | undefined {
  return markets.find((market) => matchesConditionId(market, conditionId));
}

function isEventLike(value: unknown): value is { slug: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).slug === 'string'
  );
}

function extractEventSlug(raw: Record<string, unknown>): string | null {
  const events = Array.isArray(raw.events) ? raw.events : [];
  for (const event of events) {
    if (isEventLike(event)) return event.slug;
  }
  return null;
}

function parseNumericField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseOutcomePrices(
  outcomes: string[] | undefined,
  outcomePrices: string[] | undefined,
): { outcome: string; price: number }[] {
  if (!outcomes?.length || !outcomePrices?.length) return [];
  const len = Math.min(outcomes.length, outcomePrices.length);
  const parsed: { outcome: string; price: number }[] = [];
  for (let i = 0; i < len; i++) {
    const price = Number(outcomePrices[i]);
    if (!Number.isFinite(price)) continue;
    parsed.push({ outcome: outcomes[i]!, price });
  }
  return parsed;
}

function extractEventIcon(raw: Record<string, unknown>): string | null {
  const events = Array.isArray(raw.events) ? raw.events : [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const record = event as Record<string, unknown>;
    if (typeof record.icon === 'string' && record.icon.trim()) {
      return record.icon.trim();
    }
    if (typeof record.image === 'string' && record.image.trim()) {
      return record.image.trim();
    }
  }
  return null;
}

/** Polymarket Gamma exposes icons on `icon`, `image`, or linked `events`. */
export function extractMarketIcon(raw: Record<string, unknown>): string | null {
  if (typeof raw.icon === 'string' && raw.icon.trim()) {
    return raw.icon.trim();
  }
  if (typeof raw.image === 'string' && raw.image.trim()) {
    return raw.image.trim();
  }
  return extractEventIcon(raw);
}

export function parseGammaMarketRecord(raw: Record<string, unknown>): GammaMarket {
  const tokens = parseJsonStringArray(raw.clobTokenIds);
  const outcomes = parseJsonStringArray(raw.outcomes);
  const outcomePrices = parseJsonStringArray(raw.outcomePrices);
  const pairs =
    tokens?.length === 2 && outcomes?.length === 2
      ? outcomes.map((outcome, index) => ({
          outcome,
          tokenId: tokens[index]!,
        }))
      : [];
  const outcomeFields = buildGammaOutcomeFields(pairs);

  return {
    question: typeof raw.question === 'string' ? raw.question : null,
    slug: typeof raw.slug === 'string' ? raw.slug : null,
    eventSlug: extractEventSlug(raw),
    endDate: typeof raw.endDate === 'string' ? raw.endDate : null,
    eventStartTime:
      typeof raw.eventStartTime === 'string' ? raw.eventStartTime : null,
    negRisk: Boolean(raw.negRisk),
    ...outcomeFields,
    feeRate: 0,
    feeExponent: 1,
    active: raw.active !== false,
    resolved: Boolean(raw.resolved),
    closed: Boolean(raw.closed),
    acceptingOrders: parseBooleanOrNull(raw.acceptingOrders),
    winningTokenId: determineWinnerFromPrices(tokens, outcomePrices),
    category: typeof raw.category === 'string' ? raw.category : null,
    tagSlugs: parseTagSlugsFromGammaRaw(raw),
    volume: parseNumericField(raw.volumeNum ?? raw.volume),
    volume24hr: parseNumericField(raw.volume24hr),
    liquidityClob: parseNumericField(raw.liquidityClob ?? raw.liquidityNum),
    outcomePricesParsed: parseOutcomePrices(outcomes, outcomePrices),
    outcomeTokens: outcomeFields.outcomeTokens,
    description: typeof raw.description === 'string' ? raw.description : null,
    icon: extractMarketIcon(raw),
  };
}

function parseClobRecord(raw: Record<string, unknown>): GammaMarket {
  const tokens = Array.isArray(raw.tokens)
    ? (raw.tokens as Record<string, unknown>[])
    : [];
  const pairs = tokens.flatMap((token) => {
    const tokenId =
      typeof token.token_id === 'string' ? token.token_id : null;
    if (!tokenId) return [];
    return [{ outcome: String(token.outcome ?? ''), tokenId }];
  });
  const outcomeFields = buildGammaOutcomeFields(pairs);

  const slug =
    typeof raw.market_slug === 'string'
      ? raw.market_slug
      : typeof raw.slug === 'string'
        ? raw.slug
        : null;

  return {
    question: typeof raw.question === 'string' ? raw.question : null,
    slug,
    eventSlug: extractEventSlug(raw),
    endDate:
      typeof raw.end_date_iso === 'string'
        ? raw.end_date_iso
        : typeof raw.endDate === 'string'
          ? raw.endDate
          : null,
    eventStartTime: null,
    negRisk: Boolean(raw.neg_risk ?? raw.negRisk),
    ...outcomeFields,
    feeRate: 0,
    feeExponent: 1,
    active: raw.active !== false,
    // CLOB `closed` only means trading stopped — NOT that the outcome is
    // known. Settlement is detected via isMarketSettled (winner + closed +
    // accepting_orders === false), so do not conflate the two flags here.
    resolved: Boolean(raw.resolved),
    closed: Boolean(raw.closed),
    acceptingOrders: parseBooleanOrNull(
      raw.accepting_orders ?? raw.acceptingOrders,
    ),
    winningTokenId: determineWinningTokenFromClobTokens(tokens),
    category: null,
    tagSlugs: [],
    outcomePricesParsed: [],
    outcomeTokens: outcomeFields.outcomeTokens,
    description: null,
    icon: extractMarketIcon(raw),
  };
}

async function fetchGammaMarketList(
  conditionId: string,
  closed?: boolean,
): Promise<Record<string, unknown>[]> {
  try {
    const params = new URLSearchParams({ condition_ids: conditionId });
    if (closed) params.set('closed', 'true');

    const res = await fetch(`${getGammaApiUrl()}/markets?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    return (await res.json()) as Record<string, unknown>[];
  } catch (err) {
    console.warn('fetchGammaMarketList failed', conditionId, err);
    return [];
  }
}

async function fetchClobMarket(
  conditionId: string,
): Promise<GammaMarket | null> {
  try {
    const res = await fetch(`${getClobApiUrl()}/markets/${conditionId}`);
    if (!res.ok) return null;

    const raw = (await res.json()) as Record<string, unknown>;
    if (typeof raw.error === 'string') return null;
    if (!matchesConditionId(raw, conditionId)) return null;

    const market = parseClobRecord(raw);
    await enrichWithPlatformFeeParams(market, conditionId);
    return market;
  } catch (err) {
    console.warn('fetchClobMarket failed', conditionId, err);
    return null;
  }
}

function parseClobFeeDetails(raw: Record<string, unknown>): Pick<
  GammaMarket,
  'feeRate' | 'feeExponent'
> {
  const fd = raw.fd as { r?: unknown; e?: unknown } | undefined;
  const feeRate = Number(fd?.r ?? 0);
  const feeExponent = Number(fd?.e ?? 1);
  return {
    feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0,
    feeExponent: Number.isFinite(feeExponent) && feeExponent > 0 ? feeExponent : 1,
  };
}

/** Fetch protocol fee curve from CLOB v2 (`/clob-markets/{conditionId}`). */
export async function fetchClobMarketFeeParams(
  conditionId: string,
): Promise<Pick<GammaMarket, 'feeRate' | 'feeExponent'> | null> {
  const res = await fetch(`${getClobApiUrl()}/clob-markets/${conditionId}`);
  if (!res?.ok) return null;

  const raw = (await res.json()) as Record<string, unknown>;
  if (typeof raw.error === 'string') return null;
  return parseClobFeeDetails(raw);
}

async function enrichWithPlatformFeeParams(
  market: GammaMarket,
  conditionId: string,
): Promise<void> {
  const params = await fetchClobMarketFeeParams(conditionId);
  if (!params) return;
  market.feeRate = params.feeRate;
  market.feeExponent = params.feeExponent;
}

export async function fetchGammaMarket(
  conditionId: string,
): Promise<GammaMarket | null> {
  for (const closed of [false, true] as const) {
    const markets = await fetchGammaMarketList(conditionId, closed);
    const raw = findMarketByConditionId(markets, conditionId);
    if (raw) {
      const market = parseGammaMarketRecord(raw);
      await enrichGammaMarketTags(market, raw);
      await enrichWithPlatformFeeParams(market, conditionId);
      return market;
    }
  }

  return fetchClobMarket(conditionId);
}
