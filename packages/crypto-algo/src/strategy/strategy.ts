import type { MarketListItemDto } from '@polywatch/core';
import type { MidHistorySample } from '../mid-history-buffer.js';

export type { MidHistorySample };

/** Max age for a WebSocket top-of-book to be used as primary price source. */
export const MAX_BOOK_AGE_MS = 15_000;

/**
 * Top-of-book data from WebSocket price feed.
 * Bid/ask may be null when the book is unilateral (one side empty).
 */
export interface TopOfBookData {
  /** CLOB asset id this book belongs to. */
  assetId: string;
  /** Best bid price (null if no bids). */
  bid: number | null;
  /** Best ask price (null if no asks). */
  ask: number | null;
  /** Spread (ask - bid), null if either side missing. */
  spread: number | null;
  /** Mid price ((bid + ask) / 2), null if either side missing. */
  midPrice: number | null;
  /** Spread as percentage of ask, null if either side missing. */
  spreadPercent: number | null;
  /** Epoch ms when this snapshot was last updated. */
  updatedAt: number;
}

/**
 * Signal emitted by a crypto-algo strategy when it decides a market is
 * actionable. Always a BUY on either the YES or NO outcome token.
 */
export interface AlgoSignal {
  conditionId: string;
  /** tokenIdYes or tokenIdNo — the CLOB asset to buy. */
  assetId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY';
  /** 0..1 confidence weight. */
  confidence: number;
  reasons: string[];
  strategyId: string;
  /** Market interval (e.g. "5m", "10m") used for idempotence hashing. */
  interval: string;
}

/** Structured abstain reasons for strategy evaluation observability. */
export type AbstainReasonCode =
  | 'neutral_zone'
  | 'spread_gate'
  | 'illiquid_book'
  | 'no_outcome_prices'
  | 'invalid_price_sum'
  | 'stale_book'
  | 'no_price_source'
  | 'invalid_interval'
  | 'unknown_outcomes'
  | 'missing_token'
  | 're_entry_limit'
  | 'sl_quota_reached'
  | 'price_band'
  | 'curve_descending';

export type EvaluationResult =
  | { kind: 'signal'; signal: AlgoSignal }
  | { kind: 'abstain'; reason: AbstainReasonCode; detail?: string };

/**
 * Per-evaluation context passed to strategies.
 */
export interface StrategyContext {
  /** Top-of-book for both outcomes (WebSocket), when available. */
  books?: {
    up: TopOfBookData | null;
    down: TopOfBookData | null;
  };
  /** Recent WS mid samples for curve descending gate. */
  midHistory?: {
    up: MidHistorySample[];
    down: MidHistorySample[];
  };
  /** Current timestamp */
  now: Date;
}

/**
 * A pluggable crypto-algo strategy. Implementations must be stateless across
 * calls (any state belongs on the instance, not shared mutable globals).
 */
export interface CryptoAlgoStrategy {
  readonly id: string;
  evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<EvaluationResult>;
}

/** True when both sides are present and mid can be used as a price. */
export function isBilateralBook(book: TopOfBookData | null | undefined): book is TopOfBookData & {
  bid: number;
  ask: number;
  midPrice: number;
  spread: number;
} {
  return (
    book != null &&
    book.bid != null &&
    book.ask != null &&
    book.bid > 0 &&
    book.ask > 0 &&
    book.bid <= book.ask &&
    book.midPrice != null
  );
}

/** True when the book snapshot is within {@link MAX_BOOK_AGE_MS}. */
export function isFreshBook(
  book: TopOfBookData | null | undefined,
  nowMs: number,
  maxAgeMs: number = MAX_BOOK_AGE_MS,
): boolean {
  if (!book) return false;
  return nowMs - book.updatedAt <= maxAgeMs;
}
