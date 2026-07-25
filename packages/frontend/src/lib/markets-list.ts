import { INTERVAL_TAG_SLUG, isMarketActive, type MarketListItemDto } from '@polywatch/core/market-list';

import { api } from '../api';
import type { Position } from './position';

export interface MarketsListResponse {
  items: MarketListItemDto[];
  nextCursor: string | null;
}

export const MARKETS_PAGE_SIZE = 20;
export const CRYPTO_TAG_SLUG = 'crypto';
export const CRYPTO_MARKETS_FETCH_LIMIT = 100;

export async function fetchMarketsList(params: {
  limit?: number;
  afterCursor?: string;
  order?: string;
  ascending?: boolean;
  tagSlug?: string;
  activeOnly?: boolean;
}): Promise<MarketsListResponse> {
  const search = new URLSearchParams({
    limit: String(params.limit ?? MARKETS_PAGE_SIZE),
    order: params.order ?? 'volume24hr',
    ascending: String(params.ascending ?? false),
  });
  if (params.afterCursor) {
    search.set('afterCursor', params.afterCursor);
  }
  if (params.tagSlug) {
    search.set('tagSlug', params.tagSlug);
  }
  if (params.activeOnly !== undefined) {
    search.set('active', String(params.activeOnly));
  }
  return api<MarketsListResponse>(`/markets?${search}`);
}

export function toMetricsPosition(item: MarketListItemDto): Position {
  return {
    id: 0,
    conditionId: item.conditionId,
    assetId: item.tokenIdYes ?? '',
    outcome: item.outcomePrices[0]?.outcome ?? 'Yes',
    quantity: 0,
    entryPrice: 0,
    status: 'open',
    mode: 'real',
    unrealizedPnl: 0,
    realizedPnl: 0,
    liquidityStatus: 'unknown',
    closedAt: null,
    closeReason: null,
    openedAt: null,
    traderName: null,
    traderAddress: null,
    marketQuestion: item.question,
    marketUrl: item.url,
    marketIcon: item.icon,
    marketEndDate: item.endDate,
    marketTagSlugs: item.tagSlugs,
    marketCategory: item.category,
    marketResolved: false,
    marketClosed: item.closed,
    marketAcceptingOrders: item.acceptingOrders,
    marketWinningTokenId: null,
    entryFees: 0,
  };
}

export function formatMarketEndTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface TimeRemaining {
  totalMs: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function getTimeRemaining(endDate: string | null, now = Date.now()): TimeRemaining | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  const totalMs = Math.max(0, end - now);
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  return { totalMs, minutes, seconds, expired: totalMs === 0 };
}

export function getTimeUntilStart(startDate: string | null, now = Date.now()): TimeRemaining | null {
  if (!startDate) return null;
  const start = new Date(startDate).getTime();
  if (Number.isNaN(start)) return null;
  const totalMs = Math.max(0, start - now);
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  return { totalMs, minutes, seconds, expired: totalMs === 0 };
}

export function formatMarketStartTime(value: string | null): string | null {
  return formatMarketEndTime(value);
}

export function marketListLabel(item: MarketListItemDto): string {
  if (item.question) return item.question;
  return `${item.conditionId.slice(0, 10)}…`;
}

export function formatMarketVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B Vol.`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M Vol.`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K Vol.`;
  return `${sign}$${abs.toFixed(0)} Vol.`;
}

export function formatOutcomePercent(price: number): string {
  return `${Math.round(price * 100)}%`;
}

export function topOutcomes(
  item: MarketListItemDto,
  limit = 3,
): { outcome: string; price: number }[] {
  return [...item.outcomePrices]
    .sort((a, b) => b.price - a.price)
    .slice(0, limit);
}

/**
 * Normalize outcome labels to lowercase and deduplicate them.
 * Keeps the last seen price for a given outcome (updates overwrite stale ones).
 */
export function normalizedOutcomes(
  item: MarketListItemDto,
): { outcome: string; price: number }[] {
  const map = new Map<string, { outcome: string; price: number }>();
  for (const p of item.outcomePrices) {
    const key = p.outcome.toLowerCase();
    map.set(key, { outcome: key, price: p.price });
  }
  return [...map.values()];
}

export function isBinaryUpDown(
  item: MarketListItemDto | { outcome: string; price: number }[],
): boolean {
  const outcomes = Array.isArray(item) ? item : item.outcomePrices;
  if (outcomes.length !== 2) return false;
  const labels = outcomes.map((o) => o.outcome.toLowerCase());
  return labels.includes('up') && labels.includes('down');
}

export function isCryptoUpDownMarket(item: MarketListItemDto): boolean {
  return Boolean(item.cryptoSymbol) && isBinaryUpDown(item);
}

/** Round a price to Polymarket's native 0.001 precision to avoid float artifacts. */
function roundPrice(price: number): number {
  return Math.round(price * 1000) / 1000;
}

/**
 * Merge incoming live outcome prices into the existing list.
 *
 * For binary up/down markets, the worker sends each side independently from
 * different asset order books, so the two mids may not sum to 1. When only
 * one side is updated we derive the complementary price so the UI always shows
 * up + down = 100 %.
 */
export function mergeOutcomePrices(
  existing: { outcome: string; price: number }[],
  incoming: { outcome: string; price: number }[],
): { outcome: string; price: number }[] {
  const byOutcome = new Map<string, number>();
  for (const p of existing) {
    byOutcome.set(p.outcome.toLowerCase(), p.price);
  }
  for (const p of incoming) {
    byOutcome.set(p.outcome.toLowerCase(), p.price);
  }

  const mergedOutcomes = [...byOutcome.entries()].map(([outcome, price]) => ({
    outcome,
    price,
  }));

  if (isBinaryUpDown(mergedOutcomes)) {
    const incomingKeys = new Set(incoming.map((p) => p.outcome.toLowerCase()));
    if (incomingKeys.size === 1) {
      const updated = incoming[0]!;
      const complement = updated.outcome.toLowerCase() === 'up' ? 'down' : 'up';
      byOutcome.set(complement, roundPrice(1 - updated.price));
    } else {
      const upPrice = byOutcome.get('up') ?? 0.5;
      byOutcome.set('down', roundPrice(1 - upPrice));
    }
  }

  return [...byOutcome.entries()].map(([outcome, price]) => ({
    outcome,
    price: Math.max(0, Math.min(1, price)),
  }));
}

export function matchesMarketSearch(item: MarketListItemDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.question,
    item.category,
    ...item.tagSlugs,
    item.slug,
    item.eventSlug,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export interface MarketBrowseFilters {
  searchQuery?: string;
  cryptoCategory?: string | null;
  interval?: string | null;
  cryptoSymbol?: string | null;
}

/** Apply client-side search, crypto category, interval, and crypto symbol filters to a market list. */
export function filterMarketItems(
  items: MarketListItemDto[],
  filters: MarketBrowseFilters,
): MarketListItemDto[] {
  let list = items;

  const query = filters.searchQuery?.trim();
  if (query) {
    list = list.filter((item) => matchesMarketSearch(item, query));
  }

  const category = filters.cryptoCategory;
  if (category) {
    list = list.filter((item) => item.cryptoCategory === category);
  }

  const interval = filters.interval;
  if (interval) {
    list = list.filter((item) => item.interval === interval);
  }

  const symbol = filters.cryptoSymbol;
  if (symbol) {
    list = list.filter((item) => item.cryptoSymbol === symbol);
  }

  // Hide markets whose trading window hasn't started yet or has already ended.
  list = list.filter((item) => isMarketActive(item));

  return list;
}

/** Crypto market functional categories matching the Polymarket crypto UI. */
export const CRYPTO_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'up-down', label: 'Hausse / Baisse' },
  { value: 'above-below', label: 'Au-dessus / En dessous' },
  { value: 'target-price', label: 'Prix cible' },
  { value: 'price-range', label: 'Fourchette de prix' },
  { value: 'other', label: 'Autre' },
];

/** Permanent interval filter options shown in the UI with French labels. */
export const INTERVAL_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '5m', label: '5 Min' },
  { value: '15m', label: '15 Min' },
  { value: '1h', label: '1 Heure' },
  { value: '4h', label: '4 Heures' },
  { value: '1d', label: 'Quotidien' },
  { value: '1w', label: 'Hebdomadaire' },
  { value: '1mo', label: 'Mensuel' },
  { value: '1y', label: 'Annuel' },
];


/** Short recurring windows that map to dedicated Polymarket tags (5M, 15M, …). */
export const SHORT_RECURRING_INTERVALS = new Set(['5m', '15m', '1h', '4h']);

export function resolveIntervalTagSlug(interval: string | null): string | null {
  if (!interval) return null;
  return INTERVAL_TAG_SLUG[interval] ?? null;
}
