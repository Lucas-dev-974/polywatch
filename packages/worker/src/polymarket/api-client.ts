import { config } from '../config.js';
import { normalizeOutcome, type PositionSnapshot } from '@polywatch/core';
import {
  DATA_API_PAGE_LIMIT,
  DATA_API_MAX_PAGES,
  CLOB_BOOK_FETCH_TIMEOUT_MS,
} from '../constants.js';
import { rateLimitedFetch } from './rate-limited-fetch.js';
import {
  clobBookBucket,
  dataApiGeneralBucket,
  dataApiPositionsBucket,
} from './token-bucket.js';
import { withTimeout } from '../clob/with-timeout.js';

export interface DataApiPosition {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice?: number;
  outcome?: string;
}

export async function fetchTraderPortfolioValue(
  traderAddress: string,
): Promise<number> {
  const url = `${config.dataApi}/value?user=${traderAddress}`;
  const res = await rateLimitedFetch(url, dataApiGeneralBucket);
  if (!res.ok) throw new Error(`Data API value error: ${res.status}`);
  const data = (await res.json()) as { user: string; value: number }[];
  const row = data.find(
    (entry) => entry.user.toLowerCase() === traderAddress.toLowerCase(),
  );
  return row?.value ?? data[0]?.value ?? 0;
}

export async function fetchTraderPositions(
  traderAddress: string,
): Promise<{ positions: PositionSnapshot[]; truncated: boolean }> {
  const LIMIT = DATA_API_PAGE_LIMIT;
  const MAX_PAGES = DATA_API_MAX_PAGES;
  let offset = 0;
  const allPositions: DataApiPosition[] = [];
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${config.dataApi}/positions?user=${traderAddress}&limit=${LIMIT}&offset=${offset}&sizeThreshold=0`;
    const res = await rateLimitedFetch(url, dataApiPositionsBucket);
    if (!res.ok) throw new Error(`Data API error: ${res.status}`);
    const data = (await res.json()) as DataApiPosition[];
    allPositions.push(...data);

    if (data.length < LIMIT) break;
    offset += LIMIT;
    if (page === MAX_PAGES - 1) {
      truncated = true;
    }
  }

  return {
    positions: allPositions.map((p) => ({
      conditionId: p.conditionId,
      assetId: p.asset,
      size: Number(p.size),
      avgPrice:
        p.avgPrice == null || Number.isNaN(Number(p.avgPrice))
          ? undefined
          : Number(p.avgPrice),
      outcome: normalizeOutcome(p.outcome),
    })),
    truncated,
  };
}

/**
 * Public CLOB tick-size endpoint (same source as `clobClient.getTickSize`,
 * but without credentials — used by the sim execution path).
 */
export async function fetchTickSize(assetId: string): Promise<string> {
  const url = `${config.clobApi}/tick-size?token_id=${assetId}`;
  const res = await rateLimitedFetch(url, clobBookBucket);
  if (!res.ok) throw new Error(`CLOB tick-size error: ${res.status}`);
  const data = (await res.json()) as { minimum_tick_size?: number | string };
  const tick = Number(data.minimum_tick_size);
  if (!Number.isFinite(tick) || tick <= 0) {
    throw new Error(`CLOB tick-size invalid: ${data.minimum_tick_size}`);
  }
  return String(data.minimum_tick_size);
}

export async function fetchOrderBook(assetId: string): Promise<{
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  minOrderSize?: number;
}> {
  const url = `${config.clobApi}/book?token_id=${assetId}`;
  const res = await withTimeout(
    rateLimitedFetch(url, clobBookBucket),
    CLOB_BOOK_FETCH_TIMEOUT_MS,
    'clob_book_fetch_timeout',
  );
  if (!res.ok) throw new Error(`CLOB book error: ${res.status}`);
  const data = (await res.json()) as {
    bids: { price: string; size: string }[];
    asks: { price: string; size: string }[];
    min_order_size?: string;
  };
  const minParsed = Number(data.min_order_size);
  const minOrderSize =
    Number.isFinite(minParsed) && minParsed > 0 ? minParsed : undefined;
  return {
    bids: data.bids.map((b) => ({
      price: Number(b.price),
      size: Number(b.size),
    })),
    asks: data.asks.map((a) => ({
      price: Number(a.price),
      size: Number(a.size),
    })),
    minOrderSize,
  };
}

/** Minimum share quantity for a market order on this token (public book endpoint). */
export async function fetchBookMinOrderSize(
  assetId: string,
): Promise<number | undefined> {
  const book = await fetchOrderBook(assetId);
  return book.minOrderSize;
}
