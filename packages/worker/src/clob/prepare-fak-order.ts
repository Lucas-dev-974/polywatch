import type { TickSize } from '@polymarket/clob-client-v2';
import type { DataSource } from 'typeorm';
import {
  computeTakerFee,
  Market,
  MarketService,
  RiskService,
  type ExecutionResult,
  type OrderSignal,
  type PlatformFeeParams,
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
import { resolveTickSizeCached, roundToTick } from './tick-size.js';
import pino from 'pino';

const log = pino({ name: 'prepare-fak-order' });

/** BUY entry reasons that require a fresh book snapshot before prepare. */
const ENTRY_BUY_PREPARE_REASONS = new Set([
  'COPY_OPEN',
  'COPY_INCREASE',
  'ALGO_OPEN',
  'ALGO_INCREASE',
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

  let maxSlippage = 2;
  let negRisk = false;
  let riskConfig = null as Awaited<ReturnType<RiskService['getConfig']>> | null;
  let platformFeeParams: PlatformFeeParams = { feeRate: 0, feeExponent: 1 };

  if (deps.ds) {
    const riskService = new RiskService(deps.ds);
    const marketService = new MarketService(deps.ds);
    const [config, market, fees] = await Promise.all([
      riskService.getConfig(),
      signal.conditionId
        ? deps.ds.getRepository(Market).findOne({
            where: { conditionId: signal.conditionId },
          })
        : Promise.resolve(null),
      signal.conditionId
        ? marketService.resolvePlatformFeeParams(signal.conditionId)
        : Promise.resolve(platformFeeParams),
    ]);
    riskConfig = config;
    maxSlippage = config.maxSlippagePercent ?? 2;
    negRisk = market?.negRisk === true;
    platformFeeParams = fees;
  }

  if (signal.referenceVwap != null && signal.referenceVwap > 0) {
    const guard = evaluateSlippageGuard(signal, fillPrice, maxSlippage);
    if (guard.blocked) {
      return {
        ok: false,
        result: failedExecution(signal, 'slippage_exceeded', {
          referenceVwap: signal.referenceVwap,
          slippagePercent: guard.slippagePercent,
        }),
      };
    }
    if (isForcedExitSlippageExceeded(guard.slippagePercent, maxSlippage)) {
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

  const limitPrice = roundToTick(usableFillPrice, tickSize);
  if (limitPrice <= 0) {
    return { ok: false, result: failedExecution(signal, 'price_rounded_to_zero') };
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
