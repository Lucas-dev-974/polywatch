import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  ExecutionService,
  MarketService,
  CopyConfigService,
  CryptoConfigService,
  WeatherConfigService,
  buildSlCloseRetrySignal,
  effectiveCloseRetryAttempt,
  getCopySlCloseMaxRetries,
  getCryptoSlCloseMaxRetries,
  getWeatherSlCloseMaxRetries,
  getAlgoKindForPosition,
  isMarketAwaitingRedemptionExit,
  marketLifecycleFromEntity,
  setAlgoEntryCooldown,
  shouldSuppressSlTp,
  CopiedPosition,
  type Execution,
  type ExecutionResult,
  type OrderSignal,
  type TotalCloseReason,
} from '@polywatch/core';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import {
  completeExecutionLocked,
  executionResultToFinalizeInput,
} from '../clob/execution-completion.js';
import {
  buildExecutionNotifyPayload,
  notifyBackendExecution,
} from '../clob/notify-execution.js';
import type { PositionLockRegistry } from '../clob/position-lock-registry.js';
import type { RedisQueue } from '../queue/redis-queue.js';
import {
  isSlCloseRetryableError,
  isForcedExitSignal,
} from '../execution/sl-close-retry.js';
import type { OpenPositionTracker } from './market-tracking/open-position-tracker.js';
import type { MarketTickRecorder } from './market-tracking/market-tick-recorder.js';
import pino from 'pino';
import { notifyAlgoReentryFillFromOpen } from '../algo-reentry-fill.js';
import { notifyAlgoPositionClosed } from '../algo-position-closed.js';

const log = pino({ name: 'results-consumer' });

export class ResultsConsumer {
  private executionService: ExecutionService;
  private copyConfigService: CopyConfigService;
  private cryptoConfigService: CryptoConfigService;
  private weatherConfigService: WeatherConfigService;
  private marketService: MarketService;
  private onPositionClosed?: (positionId: number) => void;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly positionLocks: PositionLockRegistry,
    private readonly closeQueue: RedisQueue<OrderSignal>,
    private readonly redisCmd: Pick<Redis, 'set'>,
    private readonly openPositionTracker?: OpenPositionTracker,
    private readonly marketTickRecorder?: MarketTickRecorder,
  ) {
    this.executionService = new ExecutionService(ds);
    this.copyConfigService = new CopyConfigService(ds);
    this.cryptoConfigService = new CryptoConfigService(ds);
    this.weatherConfigService = new WeatherConfigService(ds);
    this.marketService = new MarketService(ds);
  }

  /** Clears in-memory exit-evaluator state when a position is fully closed. */
  setOnPositionClosed(callback: (positionId: number) => void): void {
    this.onPositionClosed = callback;
  }

  async handle(result: ExecutionResult): Promise<void> {
    const execution = await this.executionService.findByOrderSignalId(
      result.orderSignalId,
    );
    if (!execution) return;

    const pos = await completeExecutionLocked(
      this.positionLocks,
      execution.copiedPositionId,
      this.ds,
      this.executionService,
      this.connectionManager,
      executionResultToFinalizeInput(result),
      { source: 'results_queue', exitReason: execution.reason },
    );

    await this.maybeSetAlgoEntryCooldown(execution, pos, result);

    if (pos) {
      void notifyBackendExecution(buildExecutionNotifyPayload(result));
      notifyAlgoReentryFillFromOpen(pos, execution, result);
      notifyAlgoPositionClosed(pos);
      this.syncPositionTracking(execution, pos, result);
      await this.maybeRetryForcedExitClose(pos, execution, result);
    }
  }

  private async maybeSetAlgoEntryCooldown(
    execution: Execution,
    pos: CopiedPosition | null,
    result: ExecutionResult,
  ): Promise<void> {
    if (result.status !== 'failed') return;
    if (execution.side !== 'BUY') return;
    const reason = result.reason ?? execution.reason;
    if (reason !== 'ALGO_OPEN') return;

    let conditionId = pos?.conditionId;
    if (!conditionId) {
      const loaded = await this.ds
        .getRepository(CopiedPosition)
        .findOne({ where: { id: execution.copiedPositionId } });
      conditionId = loaded?.conditionId;
    }
    if (!conditionId) return;

    await setAlgoEntryCooldown(
      this.redisCmd,
      conditionId,
      execution.mode as 'sim' | 'real',
    );
  }

  private syncPositionTracking(
    execution: Execution,
    pos: CopiedPosition,
    result: ExecutionResult,
  ): void {
    if (!this.openPositionTracker) return;

    if (
      execution.side === 'BUY' &&
      (result.status === 'filled' || result.status === 'partial') &&
      pos.status === 'open'
    ) {
      this.openPositionTracker.addPosition(pos);
      this.marketTickRecorder?.recordPositionOpen(pos);
      return;
    }

    if (
      execution.side === 'SELL' &&
      (result.status === 'filled' ||
        result.status === 'no_payout' ||
        pos.status === 'closed')
    ) {
      this.openPositionTracker.removePosition(pos.id, pos.assetId);
      if (pos.status === 'closed') {
        this.onPositionClosed?.(pos.id);
      }
    }
  }

  private async maybeRetryForcedExitClose(
    pos: CopiedPosition,
    execution: Execution,
    result: ExecutionResult,
  ): Promise<void> {
    if (result.status !== 'failed') return;
    if (execution.side !== 'SELL') return;

    const exitReason = (execution.reason ?? '') as OrderSignal['reason'];
    const isRetryableForcedExit =
      isForcedExitSignal({ side: 'SELL', reason: exitReason }) ||
      exitReason === 'TP';
    if (!isRetryableForcedExit) return;
    if (!isSlCloseRetryableError(result.error)) return;
    if (pos.status !== 'open') return;

    const markets = await this.marketService.loadByConditionIds([pos.conditionId]);
    const market = markets.get(pos.conditionId);
    const lifecycle = market ? marketLifecycleFromEntity(market) : null;
    if (lifecycle && shouldSuppressSlTp(lifecycle)) {
      log.debug(
        { positionId: pos.id, conditionId: pos.conditionId },
        'forced exit retry skipped — SL/TP suppressed (CLOB closed or resolved)',
      );
      return;
    }
    if (
      market &&
      isMarketAwaitingRedemptionExit(lifecycle)
    ) {
      log.debug(
        { positionId: pos.id, conditionId: pos.conditionId },
        'forced exit retry skipped — market awaiting redemption',
      );
      return;
    }

    const algoKind = getAlgoKindForPosition(pos);
    let configService: CopyConfigService | CryptoConfigService | WeatherConfigService;
    if (algoKind === 'copy') {
      configService = this.copyConfigService;
    } else if (algoKind === 'crypto') {
      configService = this.cryptoConfigService;
    } else {
      configService = this.weatherConfigService;
    }
    const algoConfig = await configService.getConfig();
    const mode = pos.mode as 'sim' | 'real';
    const typedExitReason = exitReason as TotalCloseReason | undefined;
    let maxRetries: number;
    if (algoKind === 'copy') {
      maxRetries = getCopySlCloseMaxRetries(algoConfig as any, mode);
    } else if (algoKind === 'crypto') {
      maxRetries = getCryptoSlCloseMaxRetries(algoConfig as any, mode);
    } else {
      maxRetries = getWeatherSlCloseMaxRetries(algoConfig as any, mode);
    }

    if ((pos.forcedExitFailedAttempts ?? 0) >= maxRetries) {
      log.info(
        {
          positionId: pos.id,
          failedAttempts: pos.forcedExitFailedAttempts,
          maxRetries,
          error: result.error,
          reason: typedExitReason,
        },
        'forced exit retry skipped — global attempts exhausted',
      );
      return;
    }

    const attempt = effectiveCloseRetryAttempt({
      closeRetryAttempt: result.closeRetryAttempt,
    });
    if (attempt >= maxRetries) {
      log.info(
        {
          positionId: pos.id,
          attempt,
          maxRetries,
          error: result.error,
          reason: typedExitReason,
        },
        'forced exit close retries exhausted',
      );
      return;
    }

    const metrics = this.connectionManager.getMetricsCache().get(pos.assetId);
    const lastTradePrice = metrics?.lastTradePrice;

    const retrySignal = await buildSlCloseRetrySignal({
      pos,
      previousAttempt: attempt,
      reason:
        typedExitReason === 'PRE_CLOSE_LOSS' ||
        typedExitReason === 'PRE_CLOSE_WIN' ||
        typedExitReason === 'TRAILING' ||
        typedExitReason === 'KILL_SWITCH'
          ? typedExitReason
          : typedExitReason === 'TP'
            ? 'TP'
            : 'SL',
      lastTradePrice:
        lastTradePrice != null && lastTradePrice > 0 ? lastTradePrice : undefined,
      fetchBid: async () =>
        this.connectionManager.fetchSellExecutablePrices(
          pos.assetId,
          pos.quantity,
        ),
    });

    if (!retrySignal) {
      log.debug(
        { positionId: pos.id, attempt },
        'forced exit retry deferred — no executable bid',
      );
      return;
    }

    await this.closeQueue.enqueue(retrySignal);
    log.info(
      {
        positionId: pos.id,
        attempt: effectiveCloseRetryAttempt(retrySignal),
        maxRetries,
        bidVwap: retrySignal.referenceVwap,
        lastTradePrice: retrySignal.lastTradePrice,
        error: result.error,
        reason: typedExitReason,
      },
      'forced exit close retry enqueued',
    );
  }
}
