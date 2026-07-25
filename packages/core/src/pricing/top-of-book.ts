import type { OrderBook } from '../types/index.js';
import {
  computeExecutableAskVwap,
  computeExecutableBidVwap,
} from './vwap.js';

export interface TopOfBookQuote {
  bestBid: number;
  bestAsk: number;
  spreadTop: number;
}

export function computeTopOfBook(
  book: Pick<OrderBook, 'bids' | 'asks'>,
): TopOfBookQuote | null {
  const bestBid = book.bids.length > 0 ? book.bids[0]!.price : 0;
  const bestAsk = book.asks.length > 0 ? book.asks[0]!.price : 0;
  if (bestBid <= 0 && bestAsk <= 0) return null;
  if (bestBid > 0 && bestAsk > 0 && bestAsk >= bestBid) {
    return { bestBid, bestAsk, spreadTop: bestAsk - bestBid };
  }
  if (bestBid > 0 && bestAsk <= 0) {
    return { bestBid, bestAsk: 0, spreadTop: 0 };
  }
  if (bestAsk > 0 && bestBid <= 0) {
    return { bestBid: 0, bestAsk, spreadTop: 0 };
  }
  return null;
}

export function computeExecutableSpread(
  book: Pick<OrderBook, 'bids' | 'asks'>,
  quantity: number,
): number | undefined {
  if (quantity <= 0) return undefined;
  const bid = computeExecutableBidVwap(book, quantity);
  const ask = computeExecutableAskVwap(book, quantity);
  if (bid.vwap <= 0 || ask.vwap <= 0) return undefined;
  return ask.vwap - bid.vwap;
}
