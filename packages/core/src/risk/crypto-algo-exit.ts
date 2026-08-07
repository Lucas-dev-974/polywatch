import type { CopiedPosition } from '../entities/CopiedPosition.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { MarketLifecycleState } from '../market/lifecycle.js';
import { getPositionMarkPrice } from '../positions/mark.js';
import type { LiquidityStatus } from '../types/index.js';
import {
  getCryptoAlgoExitParams,
  getCryptoAlgoPreCloseParams,
  isAlgoPositionReason,
} from './crypto-algo-helpers.js';
import {
  resolveMinTimeToCloseBufferSeconds,
  resolveLastCloseableBidMaxAgeMs,
  resolveExitDefaultsByInterval,
  resolvePreCloseSecondsByInterval,
} from './crypto-algo-tunables.js';
import {
  isExitLegEnabled,
  type ModePreCloseParams,
} from './policy.js';

/** Buffer between pre-close window start and latest allowed entry. */
export const CRYPTO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS = 30;

/** Max age for last closeable bid used in pre-close exit signals. */
export const LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000;

/** Default pre-close window (seconds) by crypto market interval. */
export const CRYPTO_INTERVAL_PRE_CLOSE_SECONDS: Readonly<Record<string, number>> = {
  '5m': 120,
  '10m': 120,
  '15m': 180,
  '30m': 240,
  '1h': 300,
  '4h': 600,
  '1d': 600,
};

/** Default SL/TP/trailing by crypto market interval for algo entry. */
export const CRYPTO_INTERVAL_EXIT_DEFAULTS: Readonly<
  Record<
    string,
    {
      trailingBidPoints: number;
      trailingActivationBidPoints: number;
      /** Stop-loss in bid points (absolute) for binary markets. */
      slBidPoints: number;
      /** Take-profit in bid points (absolute) for binary markets. */
      tpBidPoints: number;
    }
  >
> = {
  '5m': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '10m': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '15m': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '30m': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '1h': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '4h': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
  '1d': {
    trailingBidPoints: 0.05,
    trailingActivationBidPoints: 0.06,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
  },
};

export interface AlgoEntryExitParams {
  trailingBidPoints: number | null;
  trailingActivationBidPoints: number | null;
  /** Stop-loss in bid points (absolute) for binary markets. */
  slBidPoints: number | null;
  /** Take-profit in bid points (absolute) for binary markets. */
  tpBidPoints: number | null;
}

/**
 * Resolve a bid-points SL/TP override for a binary market.
 * Override (including 0/negative = disabled) → interval default → null.
 */
function pickAlgoBidPointsThreshold(
  algoOverride: number | null | undefined,
  intervalDefault: number | undefined,
): number | null {
  if (algoOverride != null) {
    return algoOverride > 0 ? algoOverride : null;
  }
  if (intervalDefault != null && intervalDefault > 0) {
    return intervalDefault;
  }
  return null;
}

/**
 * Resolve SL/TP/trailing stored on a new algo position at entry time.
 * Each leg is gated by its own enable flag; when enabled:
 * override (including 0 = disabled) → interval table → null.
 * No sim/real fallback — crypto-algo exits are mode-agnostic.
 */
export function resolveAlgoEntryExitParams(
  cfg: CryptoConfig,
  interval?: string | null,
): AlgoEntryExitParams {
  const algo = getCryptoAlgoExitParams(cfg);
  const byInterval = normalizeCryptoInterval(interval);

  const intervalDefaults = byInterval != null
    ? resolveExitDefaultsByInterval(cfg, byInterval) ??
      CRYPTO_INTERVAL_EXIT_DEFAULTS[byInterval]
    : undefined;

  // Only return bid points if interval is recognized (binary market).
  // `0` and negative values are treated as disabled (null).
  const slBidPoints =
    isExitLegEnabled(cfg.cryptoAlgoSlEnabled) && byInterval != null
      ? pickAlgoBidPointsThreshold(
          algo.cryptoAlgoSlBidPoints,
          intervalDefaults?.slBidPoints ??
            CRYPTO_INTERVAL_EXIT_DEFAULTS[byInterval]?.slBidPoints,
        )
      : null;
  const tpBidPoints =
    isExitLegEnabled(cfg.cryptoAlgoTpEnabled) && byInterval != null
      ? pickAlgoBidPointsThreshold(
          algo.cryptoAlgoTpBidPoints,
          intervalDefaults?.tpBidPoints ??
            CRYPTO_INTERVAL_EXIT_DEFAULTS[byInterval]?.tpBidPoints,
        )
      : null;

  const trailingEnabled = isExitLegEnabled(cfg.cryptoAlgoTrailingEnabled);

  return {
    trailingBidPoints: trailingEnabled
      ? pickAlgoBidPointsThreshold(
          algo.trailingBidPoints,
          intervalDefaults?.trailingBidPoints,
        )
      : null,
    trailingActivationBidPoints: trailingEnabled
      ? pickAlgoBidPointsThreshold(
          algo.trailingActivationBidPoints,
          intervalDefaults?.trailingActivationBidPoints,
        )
      : null,
    slBidPoints,
    tpBidPoints,
  };
}

const INTERVAL_ALIASES: Readonly<Record<string, string>> = {
  '5min': '5m',
  '10min': '10m',
  '15min': '15m',
  '30min': '30m',
  '1hour': '1h',
  '4hour': '4h',
  '1day': '1d',
};

const INTERVAL_SLUG_PATTERN =
  /-(5m|10m|15m|30m|1h|4h|1d)-/;

export function normalizeCryptoInterval(
  interval: string | null | undefined,
): string | null {
  if (!interval) return null;
  const normalized = INTERVAL_ALIASES[interval] ?? interval;
  return (
    normalized in CRYPTO_INTERVAL_PRE_CLOSE_SECONDS
  )
    ? normalized
    : null;
}

/** Parse interval token from Polymarket up/down slug (e.g. btc-updown-5m-123). */
export function parseIntervalFromMarketSlug(
  slug: string | null | undefined,
): string | null {
  if (!slug) return null;
  const match = slug.match(INTERVAL_SLUG_PATTERN);
  return match ? normalizeCryptoInterval(match[1]) : null;
}

export function resolveMarketInterval(
  market: { slug?: string | null; eventSlug?: string | null } | null | undefined,
  explicitInterval?: string | null,
): string | null {
  return (
    normalizeCryptoInterval(explicitInterval) ??
    parseIntervalFromMarketSlug(market?.slug ?? null) ??
    parseIntervalFromMarketSlug(market?.eventSlug ?? null)
  );
}

/**
 * Effective pre-close window length (seconds) for crypto-algo.
 * Explicit override → interval table → 0 when no interval context.
 *
 * Independent of `cryptoAlgoPreCloseEnabled`: that flag only gates forced
 * sells (`getCryptoPositionPreCloseParams`). Keeping the window when sells
 * are off preserves minTimeToClose / near-end refresh (null ≡ false).
 */
export function resolveCryptoAlgoPreCloseSeconds(
  risk: CryptoConfig,
  interval?: string | null,
): number {
  const overrides = getCryptoAlgoPreCloseParams(risk);
  if (overrides.preCloseSeconds != null) return overrides.preCloseSeconds;

  const byInterval = normalizeCryptoInterval(interval);
  if (byInterval) {
    return (
      resolvePreCloseSecondsByInterval(risk, byInterval) ??
      CRYPTO_INTERVAL_PRE_CLOSE_SECONDS[byInterval] ??
      120
    );
  }

  // No interval context — cannot resolve a table default.
  return 0;
}

/**
 * Minimum time remaining before market end to allow algo entry.
 * Null override → preClose(interval) + buffer.
 */
export function resolveCryptoAlgoMinTimeToClose(
  risk: CryptoConfig,
  interval?: string | null,
): number {
  if (risk.cryptoAlgoMinTimeToClose != null) {
    return risk.cryptoAlgoMinTimeToClose;
  }
  const preClose = resolveCryptoAlgoPreCloseSeconds(risk, interval);
  if (preClose <= 0) return 0;
  return preClose + resolveMinTimeToCloseBufferSeconds(risk);
}

export function getCryptoPositionPreCloseParams(
  cfg: CryptoConfig,
  _mode: 'sim' | 'real',
  interval?: string | null,
): ModePreCloseParams {
  const overrides = getCryptoAlgoPreCloseParams(cfg);
  const preCloseSeconds = resolveCryptoAlgoPreCloseSeconds(cfg, interval);

  return {
    preCloseEnabled:
      overrides.preCloseEnabled ?? false,
    preCloseSeconds,
    keepEnabled: overrides.preCloseKeepEnabled ?? false,
    keepBidThreshold: overrides.preCloseKeepBidThreshold ?? 0.80,
  };
}

/** @deprecated Use the per-algo dispatch in getPositionPreCloseParams. */
export function getAlgoPositionPreCloseParams(
  _cfg: CryptoConfig,
  _mode: 'sim' | 'real',
  _positionReason: string | null | undefined,
  _interval?: string | null,
): ModePreCloseParams {
  throw new Error(
    'getAlgoPositionPreCloseParams is no longer type-safe; use getPositionPreCloseParams with a typed config',
  );
}

export function isLastCloseableBidFresh(
  bidAt: Date | null | undefined,
  now = Date.now(),
  maxAgeMs: number = LAST_CLOSEABLE_BID_MAX_AGE_MS,
): boolean {
  if (!bidAt) return false;
  return now - bidAt.getTime() <= maxAgeMs;
}

export interface ExitDecisionMarkOptions {
  /** Use the minimum of all available price sources (conservative for exits). */
  conservative?: boolean;
}

/**
 * Minimum loss threshold (%) below which the conservative mark is activated.
 * Prevents micro-fluctuations at open (e.g. -0.1%) from triggering the
 * conservative mark, which could include a stale best_bid of 0.01 and cause
 * immediate SL (P1 fix, see docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md §7).
 *
 * The `liquidityStatus === 'illiquid'` check still activates the conservative
 * mark regardless of PnL, so genuinely illiquid markets are protected.
 */
export const CONSERVATIVE_MARK_MIN_LOSS_THRESHOLD = -1; // -1%

/** Whether exit decisions should use a conservative (minimum) mark. */
export function shouldUseConservativeExitMark(input: {
  trigger: number;
  closure: number;
  timeToEndMs: number;
  preCloseSeconds: number;
  liquidityStatus: LiquidityStatus;
}): boolean {
  if (input.liquidityStatus === 'illiquid') return true;
  if (
    input.trigger < CONSERVATIVE_MARK_MIN_LOSS_THRESHOLD ||
    input.closure < CONSERVATIVE_MARK_MIN_LOSS_THRESHOLD
  ) {
    return true;
  }
  if (
    input.preCloseSeconds > 0 &&
    input.timeToEndMs <= input.preCloseSeconds * 1000
  ) {
    return true;
  }
  return false;
}

type ExitMarkPosition = Pick<
  CopiedPosition,
  | 'assetId'
  | 'executableBidVwap'
  | 'entryBidVwap'
  | 'entryPrice'
  | 'lastCloseableBidVwap'
  | 'lastCloseableBidAt'
>;

/**
 * Minimum ratio of wsBestBid to bookBid for the WS bid to be considered valid
 * in the conservative mark. When the WS best bid is below this fraction of the
 * executable book bid, it is treated as a micro-bid anomaly (e.g. a single share
 * at 0.01 on an otherwise healthy book) and excluded from the MIN computation.
 *
 * This prevents false SL triggers where a tiny WS bid pulls the conservative
 * mark far below the real market price (P1 fix, see audit 2026-07-08 §4).
 *
 * Only applies when bookBid > 0 (the executable VWAP is available). When the
 * book is genuinely illiquid (bookBid === 0), the WS bid is always included.
 */
const WS_BEST_BID_MIN_RATIO = 0.5;

/**
 * Mark price for SL/pre-close decisions. When illiquid, avoids entry-price
 * fallback that masks losing positions (plan V2 §2.1).
 *
 * In illiquid conditions we prefer, in order:
 * 1. Live executable book bid VWAP.
 * 2. WebSocket best bid (filtered: excluded when anomalously low vs bookBid).
 * 3. Last trade price, when it signals a worse (lower) market value than the
 *    bid/last-closeable bid AND is fresh enough (≤ lastCloseableBidMaxAgeMs,
 *    from CryptoConfig / {@link LAST_CLOSEABLE_BID_MAX_AGE_MS} default).
 *    This prevents stale bids from hiding sharp drops on thinly traded crypto-algo
 *    markets where the last print is the best available mark. When no timestamp
 *    is available, the price is included unconditionally (backward compat for the
 *    illiquid path where lastTradePrice is the only mark).
 * 4. Fresh last closeable bid VWAP.
 * 5. Position mark-price fallback.
 *
 * When `conservative` is true (or liquidity is illiquid), returns the minimum
 * of all positive candidate sources so stale high bids cannot mask losses.
 */
export function resolveExitDecisionMarkPrice(
  position: ExitMarkPosition,
  bookBid: number,
  lifecycle: MarketLifecycleState | null | undefined,
  liquidityStatus: LiquidityStatus,
  wsBestBid?: number,
  now = Date.now(),
  lastTradePrice?: number,
  options?: ExitDecisionMarkOptions,
  /** Timestamp of the last trade, for staleness detection. */
  lastTradeTimestamp?: Date | null,
  /** Max age for last-closeable / last-trade freshness (CryptoConfig tunable). */
  lastCloseableBidMaxAgeMs: number = LAST_CLOSEABLE_BID_MAX_AGE_MS,
): number {
  const useConservativeMin =
    options?.conservative === true || liquidityStatus === 'illiquid';

  if (!useConservativeMin) {
    return getPositionMarkPrice(position, bookBid, lifecycle ?? null);
  }

  const freshLastCloseable =
    position.lastCloseableBidVwap != null &&
    position.lastCloseableBidVwap > 0 &&
    isLastCloseableBidFresh(position.lastCloseableBidAt, now, lastCloseableBidMaxAgeMs)
      ? position.lastCloseableBidVwap
      : null;

  const candidates: number[] = [];
  if (bookBid > 0) candidates.push(bookBid);

  // Include wsBestBid only when it is not anomalously low compared to the
  // executable book bid. A WS best_bid of 0.01 on a book where the executable
  // VWAP is 0.36 is a micro-bid anomaly that would corrupt the conservative
  // mark and trigger a false SL (P1 fix, audit 2026-07-08).
  if (wsBestBid != null && wsBestBid > 0) {
    const isAnomalous = bookBid > 0 && wsBestBid < bookBid * WS_BEST_BID_MIN_RATIO;
    if (!isAnomalous) {
      candidates.push(wsBestBid);
    }
  }

  // Only include lastTradePrice when it is fresh enough to avoid stale prices
  // from a previous trading session biasing the mark (E3/E7 fix).
  //
  // When no timestamp is available, fall back to the historical behaviour
  // (include the price unconditionally) so callers that do not yet propagate
  // the timestamp keep working — notably the illiquid path where lastTradePrice
  // is the only available mark and excluding it would mask real losses.
  if (lastTradePrice != null && lastTradePrice > 0) {
    const stale =
      lastTradeTimestamp != null &&
      (lastTradeTimestamp.getTime() > now ||
        now - lastTradeTimestamp.getTime() > lastCloseableBidMaxAgeMs);
    if (!stale) candidates.push(lastTradePrice);
  }

  if (freshLastCloseable != null) candidates.push(freshLastCloseable);

  if (candidates.length === 0) {
    return getPositionMarkPrice(position, bookBid, lifecycle ?? null);
  }

  return Math.min(...candidates);
}

/** Live bid sources that can refresh lastCloseableBidVwap. */
export function resolveLiveCloseableBid(
  executableBidVwap: number,
  wsBestBid?: number,
  /** Top-of-book bid with size > 0 when WS/VWAP are empty. */
  sizedBestBid?: number,
): number {
  if (executableBidVwap > 0) return executableBidVwap;
  if (wsBestBid != null && wsBestBid > 0) return wsBestBid;
  if (sizedBestBid != null && sizedBestBid > 0) return sizedBestBid;
  return 0;
}
