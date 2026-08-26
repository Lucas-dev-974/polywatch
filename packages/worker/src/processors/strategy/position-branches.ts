import {
  CopiedPosition,
  getPositionPreCloseParams,
  getPositionMarkPrice,
  resolveExitDecisionMarkPrice,
  resolveExitLifecycleFlags,
  resolveLastCloseableBidMaxAgeMs,
  shouldUseConservativeExitMark,
  type Market,
  type PnlTick,
  type LiquidityStatus,
  type TradingMode,
} from '@polywatch/core';
import type { GlobalConfig } from '@polywatch/core';
import type { CopiedPositionService } from '@polywatch/core';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import {
  buildStaleTick,
  canStillExitViaClob,
  computePnlSnapshot,
  resolveMarkState,
  type PnlSnapshot,
} from './position-evaluator.js';
import type { PnlTickPublisher } from './pnl-tick-publisher.js';
import type { PositionExitEvaluator } from './position-exit-evaluator.js';
import pino from 'pino';

const log = pino({ name: 'position-branches' });

/** Min relative drift between conservative mark and market bid to emit a warning. */
const CONSERVATIVE_MARK_DRIFT_WARN_THRESHOLD = 0.05;
/** Throttle conservative-mark drift warnings to one per position per minute. */
const CONSERVATIVE_MARK_DRIFT_THROTTLE_MS = 60_000;
const lastConservativeMarkWarnAt = new Map<number, number>();

interface BookPrices {
  executableBidVwap: number;   // qty position — émission ET décision
  liquidityStatus: LiquidityStatus;
  /** Highest bid with size > 0 (0 if none). */
  sizedBestBid?: number;
}

function resolveTimeToEndMs(market: Market | undefined, now: number): number {
  if (!market?.endDate) return Number.POSITIVE_INFINITY;
  return new Date(market.endDate).getTime() - now;
}

export interface PositionExitContext {
  exitSnap: PnlSnapshot;
  exitMark: number;
  peakClosure: number;
  timeToEndMs: number;
  preClose: ReturnType<typeof getPositionPreCloseParams>;
  suppressSlTp: boolean;
  preCloseMarketSettled: boolean;
}

/**
 * Build the full exit context for a position tick, grouping all derived values
 * that were previously computed redundantly across the pipeline.
 *
 * Returns a single object consumed by both the illiquid and liquid branches,
 * and passed to evaluateCloseLogic.
 */
export function buildPositionExitContext(params: {
  pos: CopiedPosition;
  market: Market | undefined;
  globalConfig: GlobalConfig;
  /** Per-algo config (crypto/copy/weather) — not GlobalConfig. */
  algoConfig: any;
  bookPrices: BookPrices;
  lifecycle: ReturnType<typeof resolveMarkState>['lifecycle'];
  wsBestBid?: number;
  now: number;
  marketInterval?: string | null;
  lastTradePrice?: number;
  lastTradeTimestamp?: Date | null;
  trigger: number;
  closure: number;
  peakClosure: number;
}): PositionExitContext {
  const { pos, market, algoConfig, bookPrices, lifecycle, wsBestBid, now, marketInterval, lastTradePrice, lastTradeTimestamp, trigger, closure, peakClosure } = params;

  const timeToEndMs = resolveTimeToEndMs(market, now);
  const preClose = getPositionPreCloseParams(
    algoConfig,
    pos.mode as TradingMode,
    pos.reason,
    marketInterval,
    pos.strategyId,
  );
  const lifecycleFlags = resolveExitLifecycleFlags(lifecycle, now);
  const useConservativeMark = shouldUseConservativeExitMark({
    trigger,
    closure,
    timeToEndMs,
    preCloseSeconds: preClose.preCloseSeconds,
    liquidityStatus: bookPrices.liquidityStatus,
  });
  const lastCloseableBidMaxAgeMs = resolveLastCloseableBidMaxAgeMs(algoConfig);
  const exitMark = resolveExitDecisionMarkPrice(
    pos,
    bookPrices.executableBidVwap,
    lifecycle,
    bookPrices.liquidityStatus,
    wsBestBid,
    now,
    lastTradePrice,
    { conservative: useConservativeMark },
    lastTradeTimestamp,
    lastCloseableBidMaxAgeMs,
  );

  // The decision PnL (trigger/closure) is computed on the conservative mark
  // (exitMark). This is intentional: on illiquid markets where the book bid is
  // 0, the conservative mark (min of wsBestBid / lastTradePrice /
  // lastCloseableBid) is the only available price, and the SL must be able to
  // fire on it. See patch doc §4 Décision 1 for the rationale
  // (docs/v1/v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md).
  const exitSnap = computePnlSnapshot(exitMark, pos);
  const resolvedPeakClosure = Math.max(peakClosure, exitSnap.closure);

  // Warn when the conservative mark drifts significantly from the live book
  // bid — usually a sign of a stale lastTradePrice pulling the mark down.
  // Throttled per position to avoid log spam under load (ticks run every 100ms).
  const decisionBidVwap = bookPrices.executableBidVwap;
  if (
    useConservativeMark &&
    decisionBidVwap > 0 &&
    exitMark > 0 &&
    Math.abs(exitMark - decisionBidVwap) / decisionBidVwap >
      CONSERVATIVE_MARK_DRIFT_WARN_THRESHOLD
  ) {
    const lastWarnAt = lastConservativeMarkWarnAt.get(pos.id) ?? 0;
    if (now - lastWarnAt >= CONSERVATIVE_MARK_DRIFT_THROTTLE_MS) {
      lastConservativeMarkWarnAt.set(pos.id, now);
      log.warn(
        {
          positionId: pos.id,
          assetId: pos.assetId,
          decisionBid: decisionBidVwap,
          exitMark,
          diffPercent: ((exitMark - decisionBidVwap) / decisionBidVwap) * 100,
          trigger,
          closure,
          liquidityStatus: bookPrices.liquidityStatus,
        },
        'conservative exit mark drifts significantly from live book bid — possible stale lastTradePrice',
      );
    }
  }

  // Warn when the position's mark is below its SL threshold but still open
  // (P2 monitoring, see docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md §7).
  // This detects silent danger: positions that have breached SL but haven't
  // been closed (e.g. due to no_liquidity or retry exhaustion).
  if (pos.status === 'open' && exitMark > 0) {
    // Percentage mode: closure PnL below -slPercent of invested amount.
    const slPercent = pos.slPercent;
    const slBreachedByPercent =
      slPercent != null &&
      slPercent > 0 &&
      exitSnap.closure <= -slPercent;

    if (slBreachedByPercent) {
      const lastWarnAt = lastConservativeMarkWarnAt.get(pos.id) ?? 0;
      if (now - lastWarnAt >= CONSERVATIVE_MARK_DRIFT_THROTTLE_MS) {
        lastConservativeMarkWarnAt.set(pos.id, now);
        log.warn(
          {
            positionId: pos.id,
            assetId: pos.assetId,
            exitMark,
            slPercent,
            closure,
            trigger,
            liquidityStatus: bookPrices.liquidityStatus,
            suppressSlTp: lifecycleFlags.suppressSlTp,
          },
          'position mark is below SL threshold but still open — possible missed SL',
        );
      }
    }
  }

  return {
    exitSnap,
    exitMark,
    peakClosure: resolvedPeakClosure,
    timeToEndMs,
    preClose,
    suppressSlTp: lifecycleFlags.suppressSlTp,
    preCloseMarketSettled: lifecycleFlags.marketSettled,
  };
}

async function runOpenPositionExitEval(params: {
  pos: CopiedPosition;
  market: Market | undefined;
  globalConfig: GlobalConfig;
  algoConfig: any;
  exitEvaluator: PositionExitEvaluator;
  ctx: PositionExitContext;
  bookPrices: BookPrices;
  wsBestBid?: number;
  now: number;
  marketInterval?: string | null;
  lastTradePrice?: number;
  bookUpdatedAt?: Date | null;
  lastTradeTimestamp?: Date | null;
}): Promise<void> {
  const {
    pos,
    market,
    globalConfig,
    algoConfig,
    exitEvaluator,
    ctx,
    bookPrices,
    wsBestBid,
    now,
    marketInterval,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
  } = params;

  if (pos.status !== 'open') return;
  if (!exitEvaluator.shouldRunCloseEval(pos.id, now)) return;

  await exitEvaluator.evaluateCloseLogic(
    pos,
    market,
    globalConfig,
    algoConfig,
    ctx.exitSnap.trigger,
    ctx.exitSnap.closure,
    ctx.peakClosure,
    ctx.exitSnap.unrealizedPnl,
    bookPrices.executableBidVwap,
    bookPrices.liquidityStatus,
    wsBestBid,
    marketInterval,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
    ctx.exitMark,
    bookPrices.sizedBestBid,
  );
}

export async function evaluateIlliquidPosition(params: {
  pos: CopiedPosition;
  market: Market | undefined;
  globalConfig: GlobalConfig;
  algoConfig: any;
  connectionManager: PolymarketConnectionManager;
  positionService: CopiedPositionService;
  pnlPublisher: PnlTickPublisher;
  exitEvaluator: PositionExitEvaluator;
  bookPrices: BookPrices;
  wsBestBid?: number;
  settled: boolean;
  now: number;
  markBid: number;
  marketInterval?: string | null;
  /** Last trade price from WS metrics cache — used as conservative mark when book is illiquid. */
  lastTradePrice?: number;
  /** Timestamp of the order book snapshot the bid was derived from. */
  bookUpdatedAt?: Date | null;
  /** Timestamp of the last trade price, for staleness detection. */
  lastTradeTimestamp?: Date | null;
}): Promise<PnlTick | null> {
  const {
    pos,
    market,
    globalConfig,
    algoConfig,
    connectionManager,
    positionService,
    pnlPublisher,
    exitEvaluator,
    bookPrices,
    wsBestBid,
    settled,
    now,
    markBid,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
  } = params;
  const { lifecycle } = resolveMarkState(pos, market);
  const snap = computePnlSnapshot(markBid, pos);
  const peakClosure = Math.max(pos.peakClosurePnlPercent ?? snap.closure, snap.closure);

  if (settled && lifecycle) {
    const markPrice = getPositionMarkPrice(pos, 0, lifecycle);
    const { tick } = await pnlPublisher.publishPositionPnl(
      pos,
      markPrice,
      bookPrices.liquidityStatus,
      now,
      { updatePeakTracking: false },
    );

    if (
      pos.status === 'open' &&
      canStillExitViaClob(pos, bookPrices, wsBestBid, lastTradePrice)
    ) {
      const ctx = buildPositionExitContext({
        pos,
        market,
        globalConfig,
        algoConfig,
        bookPrices,
        lifecycle,
        wsBestBid,
        now,
        marketInterval: params.marketInterval,
        lastTradePrice,
        lastTradeTimestamp,
        trigger: snap.trigger,
        closure: snap.closure,
        peakClosure,
      });

      await runOpenPositionExitEval({
        pos,
        market,
        globalConfig,
        algoConfig,
        exitEvaluator,
        ctx,
        bookPrices,
        wsBestBid,
        now,
        marketInterval: params.marketInterval,
        lastTradePrice,
        bookUpdatedAt,
        lastTradeTimestamp,
      });
    }

    return tick;
  }

  const ctx = buildPositionExitContext({
    pos,
    market,
    globalConfig,
    algoConfig,
    bookPrices,
    lifecycle,
    wsBestBid,
    now,
    marketInterval: params.marketInterval,
    lastTradePrice,
    lastTradeTimestamp,
    trigger: snap.trigger,
    closure: snap.closure,
    peakClosure,
  });

  await positionService.updatePnlFields(pos.id, {
    liquidityStatus: bookPrices.liquidityStatus,
    unrealizedPnl: ctx.exitSnap.unrealizedPnl,
    peakClosurePnlPercent: ctx.peakClosure,
    bookUpdatedAt: new Date(),
  });

  await runOpenPositionExitEval({
    pos,
    market,
    globalConfig,
    algoConfig,
    exitEvaluator,
    ctx,
    bookPrices,
    wsBestBid,
    now,
    marketInterval: params.marketInterval,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
  });

  let staleTick: PnlTick | null = null;
  if (pnlPublisher.shouldEmitTick(pos.id, now)) {
    staleTick = buildStaleTick({
      pos,
      markPrice: markBid,
      liquidityStatus: bookPrices.liquidityStatus,
      bookConnectionHealthy: connectionManager.isBookConnectionHealthy(),
    });
    pnlPublisher.markTickEmitted(pos.id, now);
  }

  return staleTick;
}

export async function evaluateLiquidPosition(params: {
  pos: CopiedPosition;
  market: Market | undefined;
  globalConfig: GlobalConfig;
  algoConfig: any;
  pnlPublisher: PnlTickPublisher;
  exitEvaluator: PositionExitEvaluator;
  bookPrices: BookPrices;
  wsBestBid?: number;
  settled: boolean;
  lifecycle: ReturnType<typeof resolveMarkState>['lifecycle'];
  now: number;
  marketInterval?: string | null;
  lastTradePrice?: number;
  /** Timestamp of the order book snapshot the bid was derived from. */
  bookUpdatedAt?: Date | null;
  /** Timestamp of the last trade price, for staleness detection. */
  lastTradeTimestamp?: Date | null;
}): Promise<PnlTick | null> {
  const {
    pos,
    market,
    globalConfig,
    algoConfig,
    pnlPublisher,
    exitEvaluator,
    bookPrices,
    wsBestBid,
    settled,
    lifecycle,
    now,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
  } = params;

  const markPrice = getPositionMarkPrice(
    pos,
    bookPrices.executableBidVwap,
    lifecycle,
  );
  const { tick, trigger, closure, peakClosure } =
    await pnlPublisher.publishPositionPnl(
      pos,
      markPrice,
      bookPrices.liquidityStatus,
      now,
      { updatePeakTracking: !settled },
    );

  if (
    settled &&
    (pos.status !== 'open' ||
      !canStillExitViaClob(pos, bookPrices, wsBestBid, lastTradePrice))
  ) {
    return tick;
  }

  const ctx = buildPositionExitContext({
    pos,
    market,
    globalConfig,
    algoConfig,
    bookPrices,
    lifecycle,
    wsBestBid,
    now,
    marketInterval: params.marketInterval,
    lastTradePrice,
    lastTradeTimestamp,
    trigger,
    closure,
    peakClosure,
  });

  await runOpenPositionExitEval({
    pos,
    market,
    globalConfig,
    algoConfig,
    exitEvaluator,
    ctx,
    bookPrices,
    wsBestBid,
    now,
    marketInterval: params.marketInterval,
    lastTradePrice,
    bookUpdatedAt,
    lastTradeTimestamp,
  });

  return tick;
}
