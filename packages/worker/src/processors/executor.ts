import type { DataSource } from 'typeorm';
import {
  CopiedPositionService,
  ExecutionService,
  isTotalCloseSignal,
  ReservationService,
  RiskService,
  computeTakerFee,
  resolveSimExecutionTunables,
  simulateFakFill,
} from '@polywatch/core';
import type { ExecutionResult, OrderSignal } from '@polywatch/core';
import type { TickSize } from '@polymarket/clob-client-v2';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import type { RedisQueue } from '../queue/redis-queue.js';
import { RealExecutor } from '../clob/real-executor.js';
import type { PositionLockRegistry } from '../clob/position-lock-registry.js';
import { MetricsReporter } from '../metrics-reporter.js';
import { reconcileInFlightIfReal } from '../clob/execution-reconciler.js';
import { failedExecution } from '../clob/execution-result.js';
import {
  completeExecution,
  executionResultToFinalizeInput,
} from '../clob/execution-completion.js';
import { prepareFakMarketOrder } from '../clob/prepare-fak-order.js';
import {
  loadRealClobMarketInfoLookup,
  minSellQuantityViolation,
} from '../clob/min-order-size.js';
import { fetchTickSize } from '../polymarket/api-client.js';
import { sampleLatencyMs } from '../execution/latency-calibrator.js';
import { getSelfImpactRegistry } from '../execution/self-impact-registry.js';
import { notifyAlgoSlQuotaInvalidate } from '../algo-sl-quota-invalidate.js';
import { runSimWalletPreflight } from '../execution/sim-wallet-preflight.js';
import { ensureBookReady } from '../polymarket/ensure-book-ready.js';
import { bookAgeMs } from '../polymarket/book-freshness.js';
import { sleepUnlessAborted } from '../helpers/sleep-unless-aborted.js';
import { withTimeout } from '../clob/with-timeout.js';
import { computeSlippagePercent } from '../execution/slippage-guard.js';

const log = pino({ name: 'executor' });

const ENTRY_BUY_REASONS = new Set(['COPY_OPEN', 'COPY_INCREASE', 'ALGO_OPEN', 'WEATHER_OPEN']);

export { sleepUnlessAborted } from '../helpers/sleep-unless-aborted.js';

export class Executor {
  private executionService: ExecutionService;
  private positionService: CopiedPositionService;
  private reservationService: ReservationService;
  private riskService: RiskService;
  private realExecutor: RealExecutor;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly resultsQueue: RedisQueue<ExecutionResult>,
    private readonly positionLocks: PositionLockRegistry,
    private readonly metricsReporter: MetricsReporter,
  ) {
    this.executionService = new ExecutionService(ds);
    this.positionService = new CopiedPositionService(ds);
    this.reservationService = new ReservationService(ds);
    this.riskService = new RiskService(ds);
    this.realExecutor = new RealExecutor(ds);
  }

  async handle(signal: OrderSignal): Promise<void> {
    return this.positionLocks.runSequentially(
      signal.copiedPositionId,
      (abortSignal) => this.executeSignal(signal, abortSignal),
    );
  }

  private async executeSignal(
    signal: OrderSignal,
    abortSignal: AbortSignal,
  ): Promise<void> {
    if (abortSignal.aborted) return;
    if (isTotalCloseSignal(signal)) {
      const closeResult = await this.positionService.beginClose(
        signal.copiedPositionId,
        signal.reason,
        signal.closingAttemptSeq,
      );
      if (!closeResult.success) {
        log.info({ signalId: signal.id }, 'close rejected — concurrent');
        return;
      }

      // P0 metrics: count exactly once per position lifecycle.
      // closingAttemptSeq === 1  → first close attempt (retries have seq >= 2)
      // !resumed                 → not a duplicate signal with the same seq
      if (closeResult.closingAttemptSeq === 1 && !closeResult.resumed) {
        this.metricsReporter.recordExit(signal.reason);
      }

      if (signal.reason === 'SL' && signal.conditionId) {
        notifyAlgoSlQuotaInvalidate(signal.conditionId, signal.mode);
      }

      // Defense-in-depth: strategy already gates mos before emitting the close
      // signal, but re-check here in case the cache expired between eval and exec.
      const belowMin = await minSellQuantityViolation(
        signal,
        signal.mode === 'real' ? await loadRealClobMarketInfoLookup() : undefined,
      );
      if (belowMin) {
        await this.positionService.revertClose(signal.copiedPositionId);
        log.info(
          {
            signalId: signal.id,
            positionId: signal.copiedPositionId,
            quantity: signal.quantity,
            minOrderShares: belowMin,
          },
          'exit deferred — quantity below market minimum order size (mos)',
        );
        return;
      }
    }

    // Guard: real BUY signals must be rejected *before* claim while the flag
    // is off. Close signals are allowed through so open positions can exit.
    if (await this.isRealEntryBlocked(signal)) {
      log.warn({ signalId: signal.id }, 'real BUY rejected — real trading disabled');
      // Release the reservation created by CopyProcessor so the pending
      // position is cancelled instead of left orphaned.
      await this.reservationService
        .release(signal.id)
        .catch((err) =>
          log.warn({ err, signalId: signal.id }, 'failed to release reservation'),
        );
      await this.resultsQueue.enqueue(failedExecution(signal, 'real_trading_disabled'));
      return;
    }

    if (await this.isSimCopyEntryBlocked(signal)) {
      log.warn({ signalId: signal.id }, 'sim COPY BUY rejected — sim copy trading disabled');
      await this.reservationService
        .release(signal.id)
        .catch((err) =>
          log.warn({ err, signalId: signal.id }, 'failed to release reservation'),
        );
      await this.resultsQueue.enqueue(failedExecution(signal, 'sim_copy_trading_disabled'));
      return;
    }

    if (await this.isRealCopyEntryBlocked(signal)) {
      log.warn({ signalId: signal.id }, 'real COPY BUY rejected — real copy trading disabled');
      await this.reservationService
        .release(signal.id)
        .catch((err) =>
          log.warn({ err, signalId: signal.id }, 'failed to release reservation'),
        );
      await this.resultsQueue.enqueue(failedExecution(signal, 'real_copy_trading_disabled'));
      return;
    }

    if (await this.rejectExpiredEntryReservation(signal)) {
      return;
    }

    let claimCompletedAt: number | undefined;
    let claimSucceeded = false;

    try {
      const claimResult = await this.executionService.claim({
        orderSignalId: signal.id,
        copiedPositionId: signal.copiedPositionId,
        mode: signal.mode,
        side: signal.side,
        reason: signal.reason,
        requestedQty: signal.quantity,
        orderType: signal.orderType,
        referenceVwap: signal.referenceVwap,
      });

      if (claimResult.alreadyInFlight) {
        if (signal.mode === 'real') {
          const reconciled = await reconcileInFlightIfReal(
            this.ds,
            claimResult.execution,
          );
          if (reconciled) {
            await this.resultsQueue.enqueue(reconciled);
          }
        }
        return;
      }
      claimCompletedAt = Date.now();
      claimSucceeded = true;
    } catch (err) {
      if ((err as Error).message === 'already_claimed') {
        if (this.isEntryBuySignal(signal)) {
          await this.reservationService
            .releaseByCopiedPositionId(signal.copiedPositionId)
            .catch((releaseErr) =>
              log.warn(
                { err: releaseErr, signalId: signal.id, positionId: signal.copiedPositionId },
                'failed to release reservation after already_claimed',
              ),
            );
          await this.resultsQueue.enqueue(
            failedExecution(signal, 'signal_id_collision'),
          );
          log.warn(
            {
              signalId: signal.id,
              positionId: signal.copiedPositionId,
              reason: signal.reason,
            },
            'entry BUY dropped — order signal already claimed',
          );
        }
        return;
      }
      throw err;
    }

    let terminalSettled = false;
    const settleTerminal = async (result: ExecutionResult): Promise<void> => {
      terminalSettled = true;
      if (signal.mode !== 'sim') {
        await this.resultsQueue.enqueue(result);
        return;
      }

      const terminalViaQueue = await this.enqueueWithRetry(result);
      if (terminalViaQueue) return;

      log.warn(
        { signalId: signal.id, positionId: signal.copiedPositionId },
        'sim terminal could not be queued — finalizing locally',
      );

      try {
        const input = executionResultToFinalizeInput(result);
        await completeExecution(
          this.ds,
          this.executionService,
          this.connectionManager,
          input,
        );
      } catch (fallbackErr) {
        log.warn(
          { err: fallbackErr, signalId: signal.id, positionId: signal.copiedPositionId },
          'sim local finalize fallback also failed — execution may stay placing',
        );
      }
    };

    try {
      if ((signal.reason === 'ALGO_OPEN' || signal.reason === 'WEATHER_OPEN') && signal.side === 'BUY') {
        const bookReady = await ensureBookReady(
          this.connectionManager,
          signal.assetId,
          abortSignal,
        );
        if (!bookReady) {
          if (abortSignal.aborted) {
            await settleTerminal(failedExecution(signal, 'position_lock_timeout'));
            return;
          }
          log.warn(
            {
              signalId: signal.id,
              assetId: signal.assetId,
              conditionId: signal.conditionId,
            },
            'algo open deferred — book not ready after subscribe and retries',
          );
          await settleTerminal(failedExecution(signal, 'no_liquidity'));
          return;
        }
      }

      const result = await this.resolveExecution(signal, abortSignal, claimCompletedAt);
      if (result) {
        await settleTerminal(result);
      } else if (signal.mode === 'real') {
        // resolveExecution returning null in real mode is intentional (WS reconcile).
        terminalSettled = true;
      }
    } catch (err) {
      log.warn(
        { err, signalId: signal.id, positionId: signal.copiedPositionId },
        'execution aborted after claim',
      );
      await settleTerminal(failedExecution(signal, 'position_lock_timeout'));
    } finally {
      if (claimSucceeded && signal.mode === 'sim' && !terminalSettled) {
        log.warn(
          { signalId: signal.id, positionId: signal.copiedPositionId },
          'sim terminal was not settled — forcing local failed finalize',
        );
        const fallbackResult = failedExecution(signal, 'position_lock_timeout');
        try {
          const input = executionResultToFinalizeInput(fallbackResult);
          await withTimeout(
            completeExecution(
              this.ds,
              this.executionService,
              this.connectionManager,
              input,
            ),
            15_000,
            'sim_local_finalize_fallback_timeout',
          );
        } catch (finallyErr) {
          log.error(
            { err: finallyErr, signalId: signal.id, positionId: signal.copiedPositionId },
            'CRITICAL: sim terminal forced finalize failed — possible placing orphan',
          );
        }
      }
    }
  }

  private async isRealEntryBlocked(signal: OrderSignal): Promise<boolean> {
    if (signal.mode !== 'real' || signal.side !== 'BUY') return false;
    const enabled = await this.riskService.isRealTradingEnabled();
    return !enabled;
  }

  private async isSimCopyEntryBlocked(signal: OrderSignal): Promise<boolean> {
    if (signal.mode !== 'sim' || signal.side !== 'BUY') return false;
    if (signal.reason !== 'COPY_OPEN' && signal.reason !== 'COPY_INCREASE') return false;
    const enabled = await this.riskService.isSimCopyTradingEnabled();
    return !enabled;
  }

  private async isRealCopyEntryBlocked(signal: OrderSignal): Promise<boolean> {
    if (signal.mode !== 'real' || signal.side !== 'BUY') return false;
    if (signal.reason !== 'COPY_OPEN' && signal.reason !== 'COPY_INCREASE') return false;
    const enabled = await this.riskService.isRealCopyTradingEnabled();
    return !enabled;
  }

  private isEntryBuySignal(signal: OrderSignal): boolean {
    return signal.side === 'BUY' && ENTRY_BUY_REASONS.has(signal.reason);
  }

  /** Fail fast when an entry reservation is gone or past TTL (stale queue backlog). */
  private async rejectExpiredEntryReservation(signal: OrderSignal): Promise<boolean> {
    if (!this.isEntryBuySignal(signal)) return false;

    const reservation = await this.reservationService.findByOrderSignalId(signal.id);
    if (reservation && reservation.expiresAt.getTime() >= Date.now()) {
      return false;
    }

    log.info(
      { signalId: signal.id, reason: signal.reason, mode: signal.mode },
      'entry BUY skipped — reservation missing or expired',
    );
    await this.reservationService
      .release(signal.id)
      .catch((err) =>
        log.warn({ err, signalId: signal.id }, 'failed to release expired reservation'),
      );
    await this.resultsQueue.enqueue(failedExecution(signal, 'reservation_expired'));
    return true;
  }

  /**
   * Returns null when the real executor produced no terminal result
   * (aborted, or order delayed/timed out and left to WS/getOrder
   * reconciliation) — nothing must be enqueued in that case.
   */
  private async resolveExecution(
    signal: OrderSignal,
    abortSignal: AbortSignal,
    claimCompletedAt?: number,
  ): Promise<ExecutionResult | null> {
    if (abortSignal.aborted) {
      return failedExecution(signal, 'position_lock_timeout');
    }

    if (signal.mode === 'sim') {
      return this.simulateFill(signal, abortSignal, undefined, claimCompletedAt);
    }

    // Second-line guard: if a real BUY signal somehow reaches this point while
    // real trading is disabled, fail it cleanly. Close signals are never blocked
    // here so open real positions can still exit.
    if (await this.isRealEntryBlocked(signal)) {
      return failedExecution(signal, 'real_trading_disabled');
    }

    return this.realExecutor.execute(signal, this.connectionManager, abortSignal);
  }

  /**
   * Sim fill: shared prepare (same as live pre-POST), optional latency, then
   * FAK against a force-refreshed book T1 at the T0 limitPrice.
   * Empty/unmatched T1 → `order_not_matched` (not `no_liquidity`).
   * Hold-if-winning is decided in prepare only (aligns with live).
   */
  private async simulateFill(
    signal: OrderSignal,
    abortSignal: AbortSignal,
    latencyMsOverride?: number,
    claimCompletedAt?: number,
  ): Promise<ExecutionResult> {
    if (abortSignal.aborted) {
      return failedExecution(signal, 'position_lock_timeout');
    }

    const risk = await this.riskService.getConfig();
    const tunables = resolveSimExecutionTunables(risk);

    const preparedResult = await prepareFakMarketOrder(
      signal,
      this.connectionManager,
      {
        ds: this.ds,
        getTickSize: async (tokenID) =>
          (await fetchTickSize(tokenID)) as TickSize,
      },
    );
    if (!preparedResult.ok) {
      return preparedResult.result;
    }

    const preparedAt = Date.now();
    const cachedBook = this.connectionManager.getOrderBook(signal.assetId);
    log.info(
      {
        signalId: signal.id,
        reason: signal.reason,
        side: signal.side,
        claim_to_prepare_ms:
          claimCompletedAt != null ? preparedAt - claimCompletedAt : undefined,
        book_age_ms: bookAgeMs(cachedBook, preparedAt),
        fillPrice: preparedResult.prepared.fillPrice,
      },
      'sim prepare complete',
    );

    if (abortSignal.aborted) {
      return failedExecution(signal, 'position_lock_timeout');
    }

    const { prepared } = preparedResult;
    const marketAmountUsdc =
      signal.side === 'BUY'
        ? Number((signal.quantity * prepared.limitPrice).toFixed(6))
        : 0;

    if (tunables.walletPreflightEnabled && signal.side === 'BUY') {
      const preflight = await runSimWalletPreflight(signal, marketAmountUsdc);
      if (preflight && !preflight.ok) {
        return failedExecution(signal, preflight.error);
      }
    }

    const latencyMs =
      latencyMsOverride ?? (await sampleLatencyMs(this.ds, tunables));

    const slept = await sleepUnlessAborted(latencyMs, abortSignal);
    if (!slept || abortSignal.aborted) {
      return failedExecution(signal, 'position_lock_timeout');
    }

    const bookT1 = await this.connectionManager.forceRefreshBook(signal.assetId);
    if (abortSignal.aborted) {
      return failedExecution(signal, 'position_lock_timeout');
    }

    let levels = bookT1
      ? signal.side === 'BUY'
        ? bookT1.asks
        : bookT1.bids
      : [];

    if (tunables.selfImpactEnabled && levels.length > 0) {
      const registry = getSelfImpactRegistry(tunables.selfImpactTtlSeconds);
      levels = registry.applyImpact(signal.assetId, signal.side, levels);
    }

    const matchQuantity =
      signal.side === 'BUY' && prepared.limitPrice > 0
        ? marketAmountUsdc / prepared.limitPrice
        : signal.quantity;

    const fak = simulateFakFill(
      levels,
      matchQuantity,
      prepared.limitPrice,
      signal.side,
    );

    if (fak.fillQuantity <= 0) {
      return failedExecution(signal, 'order_not_matched');
    }

    if (
      signal.orderType === 'FOK' &&
      fak.fillQuantity + 1e-9 < signal.quantity * 0.99
    ) {
      return failedExecution(signal, 'order_not_matched');
    }

    if (tunables.selfImpactEnabled && bookT1) {
      const registry = getSelfImpactRegistry(tunables.selfImpactTtlSeconds);
      const rawLevels =
        signal.side === 'BUY' ? bookT1.asks : bookT1.bids;
      registry.recordFill(
        signal.assetId,
        signal.side,
        rawLevels,
        matchQuantity,
        prepared.limitPrice,
      );
    }

    if (fak.fillQuantity < matchQuantity) {
      log.warn(
        {
          signalId: signal.id,
          requestedQty: matchQuantity,
          fillQuantity: fak.fillQuantity,
          limitPrice: prepared.limitPrice,
        },
        'sim FAK partial fill (book depth exhausted at limit price)',
      );
    }

    const fees = computeTakerFee(
      fak.fillQuantity,
      fak.vwap,
      prepared.platformFeeParams,
    );

    return {
      orderSignalId: signal.id,
      mode: signal.mode,
      status: 'filled',
      fillPrice: fak.vwap,
      fillQuantity: fak.fillQuantity,
      fees,
      entryBidVwap: prepared.entryBidVwap,
      referenceVwap: signal.referenceVwap,
      slippagePercent:
        signal.referenceVwap != null && signal.referenceVwap > 0
          ? computeSlippagePercent(fak.vwap, signal.referenceVwap)
          : undefined,
      closeRetryAttempt: signal.closeRetryAttempt,
      executedAt: new Date(),
    };
  }

  /**
   * Best-effort queue delivery. Returns true if Redis confirmed the enqueue.
   * Used for sim only as a fallback path to local finalize exists.
   */
  private async enqueueWithRetry(result: ExecutionResult): Promise<boolean> {
    const delaysMs = [0, 100, 300];
    for (let i = 0; i < delaysMs.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[i]));
      }
      try {
        await this.resultsQueue.enqueue(result);
        return true;
      } catch (enqueueErr) {
        log.warn(
          { err: enqueueErr, signalId: result.orderSignalId, attempt: i + 1 },
          'failed to enqueue execution result',
        );
      }
    }
    return false;
  }
}
