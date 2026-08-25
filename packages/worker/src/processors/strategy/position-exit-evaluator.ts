import type { CopiedPosition, Market, GlobalConfig, CopyConfig, CryptoConfig, WeatherConfig } from '@polywatch/core';
import {
  buildCloseOrderSignal,
  evaluatePositionExit,
  applyWeatherReentryThrottleAfterSl,
  getCopySlCloseMaxRetries,
  getCryptoSlCloseMaxRetries,
  getWeatherSlCloseMaxRetries,
  getWeatherSlConfirmationTicks,
  getPositionPreCloseParams,
  isCriticalExitEmitBlock,
  isForcedExitCloseReason,
  isMarketSettled,
  marketLifecycleFromEntity,
  resolveLastCloseableBidMaxAgeMs,
  shouldSuppressSlTp,
  type ExitEmitBlockReason,
  type LiquidityStatus,
  type OrderSignal,
  type TotalCloseReason,
  type TradingMode,
  getAlgoKindForPosition,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import type { RedisQueue } from '../../queue/redis-queue.js';
import pino from 'pino';
import { resolveCloseBid } from './close-bid.js';
import {
  BOOK_FRESHNESS_WARN_MAX_AGE_MS,
  FORCED_EXIT_RETRY_COOLDOWN_MS,
  LAST_TRADE_PRICE_MAX_AGE_MS,
  SL_CONFIRMATION_MIN_WINDOW_MS,
} from '../../constants.js';

const log = pino({ name: 'position-exit-evaluator' });
const EVAL_THROTTLE_MS = 50;
const FORCED_EXIT_EXHAUSTED_THROTTLE_MS = 60_000;
/** Persist SL-confirmation blocks at most once per this window. */
const SL_CONFIRM_BLOCK_THROTTLE_MS = 30_000;
/** Worker push alert cooldown per position. */
const EXIT_BLOCK_ALERT_COOLDOWN_MS = 5 * 60_000;
const EXIT_BLOCK_ALERT_MIN_AGE_MS = 30_000;

export type MosResolver = (
  pos: Pick<CopiedPosition, 'quantity' | 'conditionId' | 'assetId' | 'mode'>,
) => Promise<number | false>;

export type ExitEmitBlockRecorder = (
  positionId: number,
  blockReason: ExitEmitBlockReason,
  closeReason: TotalCloseReason,
  markBid?: number | null,
) => Promise<void>;

export type ExitEmitBlockClearer = (positionId: number) => Promise<void>;

export type ExitEmitBlockAlerter = (
  positionId: number,
  blockReason: ExitEmitBlockReason,
  closeReason: TotalCloseReason,
  ageMs: number,
) => Promise<void>;

interface SlConfirmationState {
  count: number;
  firstAt: number;
}

type ForcedEmitGate =
  | { ok: true }
  | { ok: false; blockReason: 'forced_exit_retries_exhausted' | 'forced_exit_cooldown' };

export class PositionExitEvaluator {
  private lastEval = new Map<number, number>();
  /** SL confirmation state per position (count + window start). */
  private slConfirmations = new Map<number, SlConfirmationState>();
  /** In-memory emit throttle until DB reflects last_forced_exit_attempt_at. */
  private lastForcedExitEmitAt = new Map<number, number>();
  private lastForcedExitExhaustedWarnAt = new Map<number, number>();
  private lastSlConfirmBlockAt = new Map<number, number>();
  private lastExitBlockAlertAt = new Map<number, number>();

  constructor(
    private readonly closeQueue: RedisQueue<OrderSignal>,
    private readonly isInFlightBuy: (positionId: number) => Promise<boolean>,
    private readonly resolveMos?: MosResolver,
    private readonly recordExitEmitBlock?: ExitEmitBlockRecorder,
    private readonly clearExitEmitBlock?: ExitEmitBlockClearer,
    private readonly alertExitEmitBlock?: ExitEmitBlockAlerter,
    private readonly redis?: Pick<Redis, 'set'>,
    private readonly ds?: DataSource,
  ) { }

  shouldRunCloseEval(positionId: number, now: number): boolean {
    const lastEval = this.lastEval.get(positionId) ?? 0;
    if (now - lastEval < EVAL_THROTTLE_MS) return false;
    this.lastEval.set(positionId, now);
    return true;
  }

  /** Clear in-memory state when a position is fully closed. */
  clearPositionState(positionId: number): void {
    this.lastEval.delete(positionId);
    this.slConfirmations.delete(positionId);
    this.lastForcedExitEmitAt.delete(positionId);
    this.lastForcedExitExhaustedWarnAt.delete(positionId);
    this.lastSlConfirmBlockAt.delete(positionId);
    this.lastExitBlockAlertAt.delete(positionId);
  }

  private totalCloseReasons = new Set<TotalCloseReason>([
    'SL',
    'TP',
    'TRAILING',
    'PRE_CLOSE_LOSS',
    'PRE_CLOSE_WIN',
    'KILL_SWITCH',
  ]);

  private forcedEmitGate(
    pos: CopiedPosition,
    closeReason: TotalCloseReason,
    globalConfig: GlobalConfig,
    algoConfig: CopyConfig | CryptoConfig | WeatherConfig,
    mode: TradingMode,
    now: number,
  ): ForcedEmitGate {
    if (!isForcedExitCloseReason(closeReason)) {
      return { ok: true };
    }

    const algoKind = getAlgoKindForPosition(pos);
    let maxRetries: number;
    if (algoKind === 'copy') {
      maxRetries = getCopySlCloseMaxRetries(algoConfig as CopyConfig, mode);
    } else if (algoKind === 'crypto') {
      maxRetries = getCryptoSlCloseMaxRetries(algoConfig as CryptoConfig, mode);
    } else {
      maxRetries = getWeatherSlCloseMaxRetries(algoConfig as WeatherConfig, mode, pos.strategyId);
    }
    const failedAttempts = pos.forcedExitFailedAttempts ?? 0;
    if (failedAttempts >= maxRetries) {
      const lastWarn = this.lastForcedExitExhaustedWarnAt.get(pos.id) ?? 0;
      if (now - lastWarn >= FORCED_EXIT_EXHAUSTED_THROTTLE_MS) {
        this.lastForcedExitExhaustedWarnAt.set(pos.id, now);
        log.warn(
          {
            positionId: pos.id,
            closeReason,
            failedAttempts,
            maxRetries,
          },
          'forced exit retries exhausted — parking position',
        );
      }
      return { ok: false, blockReason: 'forced_exit_retries_exhausted' };
    }

    const lastAttemptMs = Math.max(
      pos.lastForcedExitAttemptAt?.getTime() ?? 0,
      this.lastForcedExitEmitAt.get(pos.id) ?? 0,
    );
    if (lastAttemptMs > 0 && now - lastAttemptMs < FORCED_EXIT_RETRY_COOLDOWN_MS) {
      return { ok: false, blockReason: 'forced_exit_cooldown' };
    }

    return { ok: true };
  }

  private async isBelowMinOrderSize(
    pos: Pick<CopiedPosition, 'quantity' | 'conditionId' | 'assetId' | 'mode'>,
  ): Promise<number | false> {
    if (!this.resolveMos) return false;
    return this.resolveMos(pos);
  }

  private async noteBlock(
    pos: CopiedPosition,
    blockReason: ExitEmitBlockReason,
    closeReason: TotalCloseReason,
    now: number,
    markBid?: number | null,
  ): Promise<void> {
    if (blockReason === 'sl_pending_confirmation') {
      const last = this.lastSlConfirmBlockAt.get(pos.id) ?? 0;
      if (now - last < SL_CONFIRM_BLOCK_THROTTLE_MS) return;
      this.lastSlConfirmBlockAt.set(pos.id, now);
    }

    const prevReason = pos.lastExitBlockReason;
    const prevClose = pos.lastExitBlockCloseReason;
    const prevFirstAt = pos.firstExitBlockAt;

    if (this.recordExitEmitBlock) {
      try {
        await this.recordExitEmitBlock(
          pos.id,
          blockReason,
          closeReason,
          markBid,
        );
        // Keep in-memory pos in sync for same-tick / same-process alert age.
        const sameEpisode =
          prevReason === blockReason &&
          prevClose === closeReason &&
          prevFirstAt != null;
        pos.firstExitBlockAt = sameEpisode ? prevFirstAt : new Date(now);
        pos.lastExitBlockReason = blockReason;
        pos.lastExitBlockCloseReason = closeReason;
        pos.lastExitBlockAt = new Date(now);
      } catch (err) {
        log.warn({ err, positionId: pos.id, blockReason }, 'failed to record exit emit block');
      }
    }

    if (
      this.alertExitEmitBlock &&
      isCriticalExitEmitBlock(blockReason, closeReason)
    ) {
      const firstAt = pos.firstExitBlockAt?.getTime();
      const ageMs = firstAt != null ? now - firstAt : 0;
      if (ageMs >= EXIT_BLOCK_ALERT_MIN_AGE_MS) {
        const lastAlert = this.lastExitBlockAlertAt.get(pos.id) ?? 0;
        if (now - lastAlert >= EXIT_BLOCK_ALERT_COOLDOWN_MS) {
          this.lastExitBlockAlertAt.set(pos.id, now);
          void Promise.resolve(
            this.alertExitEmitBlock(pos.id, blockReason, closeReason, ageMs),
          ).catch((err) =>
            log.warn({ err, positionId: pos.id }, 'failed to alert exit emit block'),
          );
        }
      }
    }
  }

  private async noteClear(positionId: number): Promise<void> {
    if (!this.clearExitEmitBlock) return;
    try {
      await this.clearExitEmitBlock(positionId);
    } catch (err) {
      log.warn({ err, positionId }, 'failed to clear exit emit block');
    }
  }

  async evaluateCloseLogic(
    pos: CopiedPosition,
    market: Market | undefined,
    globalConfig: GlobalConfig,
    algoConfig: CopyConfig | CryptoConfig | WeatherConfig,
    trigger: number,
    closure: number,
    peakClosure: number,
    projectedRealizedPnlUsdc: number,
    executableBidVwap: number,
    liquidityStatus: LiquidityStatus,
    liveBestBid?: number,
    marketInterval?: string | null,
    lastTradePrice?: number,
    bookUpdatedAt?: Date | null,
    lastTradeTimestamp?: Date | null,
    preCloseMarkBid?: number,
    /** Residual top-of-book bid with size > 0 (REST/WS) when VWAP qty is empty. */
    sizedBestBid?: number | null,
  ): Promise<void> {
    if (await this.isInFlightBuy(pos.id)) {
      // Transient — do not persist as a block episode.
      return;
    }

    const lifecycle = market ? marketLifecycleFromEntity(market) : null;
    const mode = pos.mode as TradingMode;
    const preClose = getPositionPreCloseParams(
      algoConfig as any,
      mode,
      pos.reason,
      marketInterval,
      pos.strategyId,
    );
    const now = Date.now();
    const timeToEndMs = market?.endDate
      ? new Date(market.endDate).getTime() - now
      : Number.POSITIVE_INFINITY;
    const suppressSlTp = shouldSuppressSlTp(lifecycle, now);
    const decisionBidVwap = executableBidVwap;
    const decisionMarkBid = preCloseMarkBid ?? decisionBidVwap;

    this.warnStaleData(pos, lastTradePrice, lastTradeTimestamp, now);

    if (bookUpdatedAt != null) {
      const bookAgeMs = now - bookUpdatedAt.getTime();
      if (bookAgeMs > BOOK_FRESHNESS_WARN_MAX_AGE_MS) {
        log.warn(
          {
            positionId: pos.id,
            assetId: pos.assetId,
            bookAgeMs,
            thresholdMs: BOOK_FRESHNESS_WARN_MAX_AGE_MS,
            trigger,
            closure,
            liquidityStatus,
          },
          'SL/TP skipped — stale order book (fail-closed)',
        );
        return;
      }
    }

    const lastCloseableBidMaxAgeMs = resolveLastCloseableBidMaxAgeMs(algoConfig as any);

    const closeReason: TotalCloseReason | null = evaluatePositionExit({
      slTpInput: {
        trailingBidPoints: pos.trailingBidPoints,
        trailingActivationBidPoints: pos.trailingActivationBidPoints,
        effectiveTrigger: trigger,
        effectiveClosure: closure,
        peakBidVwap: pos.peakBidVwap ?? executableBidVwap,
        slBidPoints: pos.slBidPoints,
        tpBidPoints: pos.tpBidPoints,
        entryBidVwap: pos.entryBidVwap,
        slPercent: pos.slPercent,
        tpPercent: pos.tpPercent,
        trailingPercent: pos.trailingPercent,
        trailingActivationPercent: pos.trailingActivationPercent,
        peakClosurePnlPercent: peakClosure,
      },
      preCloseInput: {
        preCloseEnabled: preClose.preCloseEnabled,
        preCloseSeconds: preClose.preCloseSeconds,
        keepEnabled: preClose.keepEnabled,
        keepBidThreshold: preClose.keepBidThreshold,
        markBid: decisionMarkBid,
        effectiveTrigger: trigger,
        effectiveClosure: closure,
        timeToEndMs,
        acceptingOrders: market?.acceptingOrders ?? null,
        marketSettled: lifecycle ? isMarketSettled(lifecycle) : false,
      },
      suppressSlTp,
    });

    if (!closeReason) {
      if (pos.lastExitBlockReason != null) {
        await this.noteClear(pos.id);
        pos.lastExitBlockReason = null;
        pos.lastExitBlockCloseReason = null;
        pos.firstExitBlockAt = null;
        pos.lastExitBlockAt = null;
        pos.exitEmitBlockedCount = 0;
      }
      this.slConfirmations.delete(pos.id);
      return;
    }

    // Confirmation SL : exiger N évaluations consécutives ET une fenêtre minimale.
    const algoKind = getAlgoKindForPosition(pos);
    let slConfirmationTicks: number;
    if (algoKind === 'copy') {
      slConfirmationTicks = (algoConfig as CopyConfig).slConfirmationTicks ?? 1;
    } else if (algoKind === 'crypto') {
      slConfirmationTicks = (algoConfig as CryptoConfig).cryptoAlgoSlConfirmationTicks ?? 1;
    } else {
      slConfirmationTicks = getWeatherSlConfirmationTicks(algoConfig as WeatherConfig, pos.strategyId);
    }
    if (closeReason === 'SL' && slConfirmationTicks > 1) {
      const prev = this.slConfirmations.get(pos.id);
      const state: SlConfirmationState = prev ?? { count: 0, firstAt: now };
      state.count += 1;
      if (!prev) {
        state.firstAt = now;
      }
      this.slConfirmations.set(pos.id, state);
      const windowElapsed = now - state.firstAt >= SL_CONFIRMATION_MIN_WINDOW_MS;
      if (state.count < slConfirmationTicks || !windowElapsed) {
        log.debug(
          {
            positionId: pos.id,
            trigger,
            closure,
            count: state.count,
            required: slConfirmationTicks,
            windowMs: now - state.firstAt,
            requiredWindowMs: SL_CONFIRMATION_MIN_WINDOW_MS,
          },
          'SL signal pending confirmation',
        );
        await this.noteBlock(
          pos,
          'sl_pending_confirmation',
          closeReason,
          now,
          decisionBidVwap,
        );
        return;
      }
      this.slConfirmations.delete(pos.id);
    } else if (closeReason !== 'SL') {
      this.slConfirmations.delete(pos.id);
    }

    const useDecisionMarkForClose =
      closeReason === 'PRE_CLOSE_LOSS' ||
      closeReason === 'PRE_CLOSE_WIN';

    const allowLastCloseableFallback =
      closeReason === 'PRE_CLOSE_LOSS' ||
      closeReason === 'PRE_CLOSE_WIN' ||
      closeReason === 'SL' ||
      closeReason === 'TRAILING';

    const closeBid = useDecisionMarkForClose && decisionMarkBid > 0
      ? decisionMarkBid
      : resolveCloseBid(
        executableBidVwap,
        liveBestBid,
        pos.executableBidVwap,
        pos.lastCloseableBidVwap,
        pos.lastCloseableBidAt,
        allowLastCloseableFallback,
        sizedBestBid,
        lastCloseableBidMaxAgeMs,
      );

    const freshLastTrade =
      lastTradePrice != null &&
      lastTradePrice > 0 &&
      lastTradeTimestamp != null &&
      now - lastTradeTimestamp.getTime() <= lastCloseableBidMaxAgeMs;

    const canUseFreshLastTradeFallback =
      closeReason === 'PRE_CLOSE_LOSS' ||
      closeReason === 'PRE_CLOSE_WIN' ||
      closeReason === 'SL' ||
      closeReason === 'TRAILING';

    const emitBid =
      closeBid > 0
        ? closeBid
        : freshLastTrade && canUseFreshLastTradeFallback
          ? lastTradePrice!
          : 0;

    if (closeReason && emitBid > 0) {
      if (
        closeReason !== 'KILL_SWITCH' &&
        this.totalCloseReasons.has(closeReason)
      ) {
        const belowMin = await this.isBelowMinOrderSize(pos);
        if (belowMin !== false) {
          log.debug(
            {
              positionId: pos.id,
              closeReason,
              quantity: pos.quantity,
              minShares: belowMin,
            },
            'algo exit deferred — quantity below market minimum order size (strategy gate)',
          );
          await this.noteBlock(
            pos,
            'below_min_order_size',
            closeReason,
            now,
            decisionBidVwap,
          );
          return;
        }
      }

      const gate = this.forcedEmitGate(pos, closeReason, globalConfig, algoConfig, mode, now);
      if (!gate.ok) {
        await this.noteBlock(
          pos,
          gate.blockReason,
          closeReason,
          now,
          decisionBidVwap,
        );
        return;
      }

      try {
        // Do NOT clear exit-emit block on enqueue — wait for fill / terminal close.
        await this.emitCloseSignal(pos, closeReason, emitBid, lastTradePrice, algoConfig);
      } catch (err) {
        // Enqueue failed (e.g. Redis down): do NOT arm the cooldown marker so
        // the next evaluation can retry the critical exit immediately.
        log.error(
          { err, positionId: pos.id, closeReason },
          'close signal enqueue failed — will retry on next evaluation',
        );
        return;
      }
      this.lastForcedExitEmitAt.set(pos.id, now);
      return;
    }

    if (closeReason) {
      const isCriticalExit =
        closeReason === 'SL' ||
        closeReason === 'TRAILING' ||
        closeReason === 'KILL_SWITCH';
      const blockedLog = isCriticalExit ? log.warn.bind(log) : log.debug.bind(log);
      blockedLog(
        {
          positionId: pos.id,
          closeReason,
          timeToEndMs,
          trigger,
          closure,
          executableBidVwap,
          liveBestBid,
          sizedBestBid,
          lastCloseableBidVwap: pos.lastCloseableBidVwap,
          liquidityStatus,
          freshLastTrade,
        },
        'exit signal blocked — no close bid',
      );
      await this.noteBlock(pos, 'no_close_bid', closeReason, now, decisionBidVwap);
    }
  }

  private warnStaleData(
    pos: CopiedPosition,
    lastTradePrice: number | undefined,
    lastTradeTimestamp: Date | null | undefined,
    now: number,
  ): void {
    if (lastTradePrice != null && lastTradePrice > 0 && lastTradeTimestamp != null) {
      const tradeAgeMs = now - lastTradeTimestamp.getTime();
      if (tradeAgeMs > LAST_TRADE_PRICE_MAX_AGE_MS) {
        log.warn(
          {
            positionId: pos.id,
            assetId: pos.assetId,
            tradeAgeMs,
            thresholdMs: LAST_TRADE_PRICE_MAX_AGE_MS,
            lastTradePrice,
          },
          'SL/TP mark influenced by stale lastTradePrice — conservative mark may be misleading',
        );
      }
    }
  }

  async emitCloseSignal(
    pos: CopiedPosition,
    reason: TotalCloseReason,
    bidVwap: number,
    lastTradePrice?: number,
    algoConfig?: CopyConfig | CryptoConfig | WeatherConfig,
  ): Promise<void> {
    await this.closeQueue.enqueue(
      buildCloseOrderSignal({ pos, reason, bidVwap, lastTradePrice }),
    );
    if (
      reason === 'SL' &&
      pos.reason === 'WEATHER_OPEN' &&
      getAlgoKindForPosition(pos) === 'weather' &&
      algoConfig &&
      this.redis &&
      this.ds
    ) {
      try {
        await applyWeatherReentryThrottleAfterSl({
          redis: this.redis,
          ds: this.ds,
          position: pos,
          weatherConfig: algoConfig as WeatherConfig,
        });
      } catch (err) {
        log.warn({ err, positionId: pos.id }, 'failed to set weather SL re-entry throttle');
      }
    }
  }
}
