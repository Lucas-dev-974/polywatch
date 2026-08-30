import type { TickSize } from '@polymarket/clob-client-v2';
import type { DataSource } from 'typeorm';
import {
  Market,
  MarketService,
  GlobalConfigService,
  type ExecutionResult,
  type OrderSignal,
  type PlatformFeeParams,
  shouldSkipNoLiquidityAsk,
} from '@polywatch/core';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import { ALGO_BOOK_FRESH_MS } from '../polymarket/book-freshness.js';
import {
  evaluateSlippageGuard,
  isForcedExitSlippageExceeded,
} from '../execution/slippage-guard.js';
import { failedExecution } from './execution-result.js';
import type { ClobMarketInfoLookup } from './min-order-size.js';
import { resolveMinOrderSharesForSignal } from './min-order-size.js';
import { ceilToTick, floorToTick, resolveTickSizeCached } from './tick-size.js';
import { SLIPPAGE_GUARDED_REASONS, MIN_SLIPPAGE_TICKS } from '../constants.js';
import pino from 'pino';

const log = pino({ name: 'prepare-fak-order' });

/** BUY entry reasons that require a fresh book snapshot before prepare. */
const ENTRY_BUY_PREPARE_REASONS = new Set([
  'COPY_OPEN',
  'COPY_INCREASE',
  'ALGO_OPEN',
  'ALGO_INCREASE',
  'WEATHER_OPEN',
]);

export type PreparedFakOrder = {
  limitPrice: number;
  /** Executable VWAP at T0 before lastTrade tighten. */
  fillPrice: number;
  /** Price used for tick rounding (may be lastTrade-tightened on SELL). */
  usableFillPrice: number;
  tickSize: TickSize;
  negRisk: boolean;
  platformFeeParams: PlatformFeeParams;
  /** Always T0 executable bid VWAP (matches RealExecutor entryBidVwap). */
  entryBidVwap: number;
};

export type PrepareFakResult =
  | { ok: true; prepared: PreparedFakOrder }
  | { ok: false; result: ExecutionResult };

export type PrepareFakOrderDeps = {
  ds?: DataSource;
  getTickSize: (tokenID: string) => Promise<TickSize>;
  getClobMarketInfo?: ClobMarketInfoLookup;
};

/**
 * Shared pre-POST pipeline for real and sim FAK orders: book VWAP, slippage,
 * tick, optional SELL lastTrade tighten, MOS, hold-if-winning.
 */
export async function prepareFakMarketOrder(
  signal: OrderSignal,
  connectionManager: PolymarketConnectionManager,
  deps: PrepareFakOrderDeps,
): Promise<PrepareFakResult> {
  const bookOpts =
    signal.side === 'BUY' && ENTRY_BUY_PREPARE_REASONS.has(signal.reason)
      ? { maxAgeMs: ALGO_BOOK_FRESH_MS }
      : undefined;

  const prices =
    signal.side === 'SELL'
      ? await connectionManager.fetchSellExecutablePrices(
          signal.assetId,
          signal.quantity,
        )
      : await connectionManager.fetchExecutablePrices(
          signal.assetId,
          signal.quantity,
          bookOpts,
        );
  const fillPrice =
    signal.side === 'BUY' ? prices.executableAskVwap : prices.executableBidVwap;

  if (fillPrice <= 0) {
    return { ok: false, result: failedExecution(signal, 'no_liquidity') };
  }

  if (signal.side === 'BUY') {
    const notional =
      signal.pusdAmount != null && signal.pusdAmount > 0
        ? signal.pusdAmount
        : fillPrice * signal.quantity;
    if (
      shouldSkipNoLiquidityAsk({
        askVwap: fillPrice,
        notionalPusd: notional,
        impliedQty: signal.quantity,
        askLiquidityStatus: prices.askLiquidityStatus,
        liquidityStatus: prices.liquidityStatus,
      })
    ) {
      return { ok: false, result: failedExecution(signal, 'no_liquidity') };
    }
  }

  let maxSlippage = 2;
  let negRisk = false;
  let globalConfig = null as Awaited<ReturnType<GlobalConfigService['getConfig']>> | null;
  let platformFeeParams: PlatformFeeParams = { feeRate: 0, feeExponent: 1 };

  if (deps.ds) {
    const globalConfigService = new GlobalConfigService(deps.ds);
    const marketService = new MarketService(deps.ds);
    const [config, market, fees] = await Promise.all([
      globalConfigService.getConfig(),
      signal.conditionId
        ? deps.ds.getRepository(Market).findOne({
            where: { conditionId: signal.conditionId },
          })
        : Promise.resolve(null),
      signal.conditionId
        ? marketService.resolvePlatformFeeParams(signal.conditionId)
        : Promise.resolve(platformFeeParams),
    ]);
    globalConfig = config;
    maxSlippage = config.maxSlippagePercent ?? 2;
    negRisk = market?.negRisk === true;
    platformFeeParams = fees;
  }

  // Live CLOB market info is the matcher source of truth (weather BUY must
  // grant pusdToAdapter, not Exchange V2). Gamma/DB bit is the fallback.
  if (deps.getClobMarketInfo && signal.conditionId) {
    try {
      const info = await deps.getClobMarketInfo(signal.conditionId);
      if (typeof info?.negRisk === 'boolean') {
        negRisk = info.negRisk;
      } else if (typeof info?.neg_risk === 'boolean') {
        negRisk = info.neg_risk;
      }
    } catch {
      // keep Gamma/DB bit
    }
  }

  let tickSize: TickSize;
  try {
    tickSize = await resolveTickSizeCached(signal.assetId, {
      getTickSize: deps.getTickSize,
    });
  } catch {
    return { ok: false, result: failedExecution(signal, 'tick_size_fetch_failed') };
  }

  let usableFillPrice = fillPrice;
  if (
    signal.side === 'SELL' &&
    signal.lastTradePrice != null &&
    signal.lastTradePrice > 0 &&
    signal.lastTradePrice < fillPrice
  ) {
    log.info(
      {
        signalId: signal.id,
        reason: signal.reason,
        executableBidVwap: fillPrice,
        lastTradePrice: signal.lastTradePrice,
      },
      'forced SELL limit price lowered to lastTradePrice due to stale bid',
    );
    usableFillPrice = signal.lastTradePrice;
  }

  // BUY FAK must not round *below* the ask (nearest can miss the book).
  // SELL FAK must not round *above* the bid.
  let limitPrice =
    signal.side === 'BUY'
      ? ceilToTick(usableFillPrice, tickSize)
      : floorToTick(usableFillPrice, tickSize);
  if (limitPrice <= 0) {
    return { ok: false, result: failedExecution(signal, 'price_rounded_to_zero') };
  }

  // Weather YES books are thin: posting *at* the ask is often unmatched by the
  // CLOB FAK matcher. Pay extra ticks after the slippage check so the order is
  // marketable without counting the pad as a market move. The pad is clamped to
  // [0, 3] and the slippage guard's tick floor is raised to at least the pad so
  // the pad itself is never treated as an adverse move.
  let padTicks = 0;
  if (signal.side === 'BUY' && signal.reason === 'WEATHER_OPEN') {
    const rawPad = Number(signal.entryTickPad ?? 1);
    padTicks = Number.isFinite(rawPad)
      ? Math.min(3, Math.max(0, Math.floor(rawPad)))
      : 0;
  }

  if (signal.referenceVwap != null && signal.referenceVwap > 0) {
    const tick = Number(tickSize);
    const guard = evaluateSlippageGuard(signal, limitPrice, maxSlippage, {
      tickSize: Number.isFinite(tick) && tick > 0 ? tick : undefined,
      minTicks: Math.max(MIN_SLIPPAGE_TICKS, padTicks),
    });
    if (guard.blocked) {
      return {
        ok: false,
        result: failedExecution(signal, 'slippage_exceeded', {
          referenceVwap: signal.referenceVwap,
          slippagePercent: guard.slippagePercent,
        }),
      };
    }
    if (
      !(SLIPPAGE_GUARDED_REASONS as readonly string[]).includes(signal.reason) &&
      isForcedExitSlippageExceeded(guard.slippagePercent, maxSlippage)
    ) {
      log.warn(
        {
          signalId: signal.id,
          reason: signal.reason,
          slippagePercent: guard.slippagePercent,
          maxSlippagePercent: maxSlippage,
        },
        'forced exit slippage exceeds configured max (not blocked)',
      );
    }
  } else {
    log.warn(
      { signalId: signal.id, reason: signal.reason },
      'slippage guard skipped — no referenceVwap',
    );
  }

  if (padTicks > 0) {
    const tick = Number(tickSize);
    if (Number.isFinite(tick) && tick > 0) {
      limitPrice = ceilToTick(limitPrice + tick * padTicks, tickSize);
    }
    if (limitPrice <= 0) {
      return { ok: false, result: failedExecution(signal, 'price_rounded_to_zero') };
    }
  }

  const minOrderShares = await resolveMinOrderSharesForSignal(
    signal,
    deps.getClobMarketInfo,
  );
  if (signal.quantity < minOrderShares) {
    return { ok: false, result: failedExecution(signal, 'below_min_order_size') };
  }

  return {
    ok: true,
    prepared: {
      limitPrice,
      fillPrice,
      usableFillPrice,
      tickSize,
      negRisk,
      platformFeeParams,
      entryBidVwap: prices.executableBidVwap,
    },
  };
}
