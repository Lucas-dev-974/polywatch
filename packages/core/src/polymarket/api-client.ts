import { rateLimitedFetch } from './rate-limited-fetch.js';
import { clobBookBucket } from './token-bucket.js';

export async function fetchOrderBook(
  clobApi: string,
  assetId: string,
): Promise<{
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  minOrderSize?: number;
}> {
  const url = `${clobApi}/book?token_id=${assetId}`;
  const res = await rateLimitedFetch(url, clobBookBucket);
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
  clobApi: string,
  assetId: string,
): Promise<number | undefined> {
  const book = await fetchOrderBook(clobApi, assetId);
  return book.minOrderSize;
}