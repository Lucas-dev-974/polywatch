import { Redis } from 'ioredis';
import pino from 'pino';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  SimulationService,
  CopiedPositionService,
  ExecutionService,
  MarketPositionTickService,
  MarketPriceTickService,
  MarketPriceHistorySyncService,
  createRedis,
  WORKER_QUEUES,
  ALGO_SELECTIONS_CHANGED_CHANNEL,
  SIMULATION_RESET_CHANNEL,
  parseSimulationResetPayload,
} from '@polywatch/core';
import type { OrderSignal, ExecutionResult } from '@polywatch/core';
import { config } from './config.js';
import { RedisQueue } from './queue/redis-queue.js';
import { notifyBackendAlert } from './clob/notify-alert.js';
import { PolymarketConnectionManager } from './polymarket/connection-manager.js';
import { syncBookSubscriptions } from './polymarket/sync-book-subscriptions.js';
import { Executor } from './processors/executor.js';
import { ResultsConsumer } from './processors/results-consumer.js';
import { StrategyProcessing } from './processors/strategy-processing.js';
import { MetricsReporter } from './metrics-reporter.js';
import { MarketPercentPublisher } from './processors/strategy/market-percent-publisher.js';
import { OpenPositionTracker } from './processors/market-tracking/open-position-tracker.js';
import { MarketTickRecorder } from './processors/market-tracking/market-tick-recorder.js';
import { MarketPriceHistorySyncer } from './processors/market-tracking/market-price-history-syncer.js';
import { RedemptionHandler } from './processors/redemption-handler.js';
import { MarketResolutionWatcher } from './processors/market-resolution-watcher.js';
import { ClosingWatchdog } from './watchdogs/closing-watchdog.js';
import { PlacingJanitor } from './watchdogs/placing-janitor.js';
import { ReservationJanitor } from './watchdogs/reservation-janitor.js';
import { PendingEntryJanitor } from './watchdogs/pending-entry-janitor.js';
import { SimRealismJanitor } from './watchdogs/sim-realism-janitor.js';
import { clearTradingContextCache, loadTradingContext, refreshTradingContext } from './clob/trading-context.js';
import { reconcilePlacingExecutions } from './clob/execution-reconciler.js';
import { waitForBackendReady } from './clob/backend-readiness.js';
import { UserChannelManager } from './clob/user-channel-manager.js';
import { PositionLockRegistry } from './clob/position-lock-registry.js';
import { refreshWorkerContext } from './worker-context-refresh.js';
import { configureAlgoSlQuotaInvalidatePublisher } from './algo-sl-quota-invalidate.js';
import { configureAlgoReentryFillPublisher } from './algo-reentry-fill.js';
import { configureAlgoPositionClosedPublisher } from './algo-position-closed.js';
import { safeInterval } from './helpers.js';
import {
  HEARTBEAT_INTERVAL_MS,
  BOOK_SUBSCRIPTION_SYNC_MS,
  MARKET_RESOLUTION_LOOP_MS,
  REDEMPTION_LOOP_MS,
  CLOSING_WATCHDOG_LOOP_MS,
  PLACING_JANITOR_LOOP_MS,
  RESERVATION_JANITOR_LOOP_MS,
  PENDING_ENTRY_JANITOR_LOOP_MS,
  STRATEGY_EVAL_INTERVAL_MS,
  BACKEND_READY_TIMEOUT_MS,
  initWorkerConfigCache,
  workerConfig,
} from './constants.js';

const log = pino({ name: 'worker' });

async function main() {
  const ds = await initializeDataSource(createDataSource());
  await assertDatabaseExists(ds);
  await initWorkerConfigCache(ds);

  const simulationService = new SimulationService(ds);
  try {
    for (const algoKind of ['crypto', 'weather', 'copy'] as const) {
      const integrity = await simulationService.ensureCashIntegrity(algoKind);
      if (integrity.repaired) {
        log.warn(
          {
            algoKind,
            drift: integrity.drift,
            expectedCash: integrity.expectedCash,
            baselineCapital: integrity.baselineCapital,
          },
          'simulation cash reconciled from execution ledger',
        );
      }
    }
  } catch (err) {
    log.error({ err }, 'simulation cash integrity check failed');
  }

  // Redis forbids queue commands on a connection in SUBSCRIBE mode — keep roles separate.
  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();
  configureAlgoSlQuotaInvalidatePublisher(redisPub);
  configureAlgoReentryFillPublisher(redisPub, ds);
  configureAlgoPositionClosedPublisher(redisPub);
  const redisOrderConsumer = createRedis();
  const redisAlgoOrderConsumer = createRedis();
  const redisWeatherOrderConsumer = createRedis();
  const redisCloseConsumer = createRedis();
  const redisResultsConsumer = createRedis();

  const connectionManager = new PolymarketConnectionManager();

  const closeQueue = new RedisQueue<OrderSignal>(redisCmd, 'close-signals', async () => {});
  const resultsQueue = new RedisQueue<ExecutionResult>(
    redisCmd,
    'execution-results',
    async () => {},
  );

  const positionLocks = new PositionLockRegistry();
  const metricsReporter = new MetricsReporter();
  const executorA = new Executor(ds, connectionManager, resultsQueue, positionLocks, metricsReporter);
  const executorB = new Executor(ds, connectionManager, resultsQueue, positionLocks, metricsReporter);
  const tickService = new MarketPositionTickService(ds);
  const openPositionTracker = new OpenPositionTracker(ds);
  const marketTickRecorder = new MarketTickRecorder(
    connectionManager,
    openPositionTracker,
    tickService,
  );
  const resultsConsumer = new ResultsConsumer(
    ds,
    connectionManager,
    positionLocks,
    closeQueue,
    redisCmd,
    openPositionTracker,
    marketTickRecorder,
  );
  const strategy = new StrategyProcessing(ds, connectionManager, closeQueue, async (snapshot) => {
    await metricsReporter.pushStrategyCycle({
      durationMs: snapshot.durationMs,
      positionsEvaluated: snapshot.positionsEvaluated,
      positionsOpen: snapshot.positionsOpen,
      positionsOpenByMode: snapshot.positionsOpenByMode,
      positionsByStatus: snapshot.positionsByStatus,
      illiquidPositions: snapshot.illiquidPositions,
      spreadMean: snapshot.spreadMean,
    });
  });
  resultsConsumer.setOnPositionClosed((positionId) =>
    strategy.clearExitState(positionId),
  );
  const redemption = new RedemptionHandler(ds, resultsQueue);
  const marketResolutionWatcher = new MarketResolutionWatcher(ds);
  const closingWatchdog = new ClosingWatchdog(ds);
  const placingJanitor = new PlacingJanitor(ds, redisCmd);
  const reservationJanitor = new ReservationJanitor(ds);
  const pendingEntryJanitor = new PendingEntryJanitor(
    ds,
    connectionManager,
    new RedisQueue<OrderSignal>(redisCmd, WORKER_QUEUES.ALGO_ORDER_SIGNALS, async () => {}),
  );
  const simRealismJanitor = new SimRealismJanitor(ds);

  const orderQueueConsumer = new RedisQueue<OrderSignal>(
    redisOrderConsumer,
    WORKER_QUEUES.ORDER_SIGNALS,
    (job) => executorA.handle(job),
    { onDeadLetter: notifyBackendAlert },
  );
  const algoOrderQueueConsumer = new RedisQueue<OrderSignal>(
    redisAlgoOrderConsumer,
    WORKER_QUEUES.ALGO_ORDER_SIGNALS,
    (job) => executorA.handle(job),
    { onDeadLetter: notifyBackendAlert },
  );
  const weatherOrderQueueConsumer = new RedisQueue<OrderSignal>(
    redisWeatherOrderConsumer,
    WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
    (job) => executorA.handle(job),
    { onDeadLetter: notifyBackendAlert },
  );
  const closeQueueConsumer = new RedisQueue<OrderSignal>(
    redisCloseConsumer,
    'close-signals',
    (job) => executorB.handle(job),
    { onDeadLetter: notifyBackendAlert },
  );
  const resultsQueueConsumer = new RedisQueue<ExecutionResult>(
    redisResultsConsumer,
    'execution-results',
    (job) => resultsConsumer.handle(job),
    { onDeadLetter: notifyBackendAlert },
  );

  // Wait for the backend to be ready before requesting internal credentials.
  // This avoids ECONNREFUSED races when both services start in parallel.
  try {
    await waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS);
  } catch (err) {
    log.warn(
      { err },
      'backend-ready signal not received within timeout — falling back to HTTP retry',
    );
  }

  const tradingContext = await loadTradingContext();
  const userChannel = new UserChannelManager(ds, connectionManager, positionLocks);

  if (tradingContext) {
    try {
      await reconcilePlacingExecutions(ds, tradingContext.clobClient, connectionManager);
    } catch (err) {
      log.error({ err }, 'startup reconciliation failed');
    }
  }

  await orderQueueConsumer.recoverOrphans();
  await algoOrderQueueConsumer.recoverOrphans();
  await weatherOrderQueueConsumer.recoverOrphans();
  await closeQueueConsumer.recoverOrphans();
  await resultsQueueConsumer.recoverOrphans();

  // Backfill legacy closing rows
  const positionService = new CopiedPositionService(ds);
  const backfillCount = await positionService.backfillClosingStartedAt();
  if (backfillCount > 0) {
    log.info({ count: backfillCount }, 'backfilled closing_started_at for legacy rows');
  }

  const executionService = new ExecutionService(ds);
  const revertedClosingIds = await positionService.reconcileClosingOnClosedClob();
  if (revertedClosingIds.length > 0) {
    log.warn(
      { positionIds: revertedClosingIds },
      'reverted closing positions on markets with accepting_orders=false',
    );
    for (const positionId of revertedClosingIds) {
      const cancelled = await executionService.failActiveForPosition(positionId);
      if (cancelled > 0) {
        log.warn(
          { positionId, cancelled },
          'cancelled in-flight executions after CLOB-closed reconciliation',
        );
      }
    }
  }

  // Connect WebSocket order book stream before starting loops
  const wsClient = connectionManager.getWsClient();
  try {
    await wsClient.connect();
    log.info('WebSocket order books connected');
  } catch (err) {
    log.warn({ err }, 'WebSocket connection failed — falling back to REST');
  }

  // Full book sync fetches hundreds of Up/Down REST snapshots and can take
  // minutes (rate limits, timeouts). Never block startup on it — the queue
  // consumers below must come up immediately; books load on demand meanwhile.
  void syncBookSubscriptions(ds, connectionManager)
    .then(() => log.info('initial book subscription sync complete'))
    .catch((err) => log.error({ err }, 'initial book subscription sync failed'));

  let marketResolvedDebounce: ReturnType<typeof setTimeout> | null = null;
  wsClient.setOnMarketResolved(() => {
    if (marketResolvedDebounce) clearTimeout(marketResolvedDebounce);
    marketResolvedDebounce = setTimeout(() => {
      void marketResolutionWatcher.processAll().catch((err) =>
        log.error({ err }, 'market resolution watcher processAll failed'),
      );
    }, 2_000);
  });

  if (tradingContext) {
    const connected = await userChannel.ensureConnected(tradingContext.wsAuth);
    if (connected) {
      log.info('WebSocket user channel connected');
    }
  }

  const percentPublisher = new MarketPercentPublisher(connectionManager);

  const marketPriceTickService = new MarketPriceTickService(ds);
  const marketPriceHistorySyncService = new MarketPriceHistorySyncService(ds);
  const marketPriceHistorySyncer = new MarketPriceHistorySyncer(
    ds,
    marketPriceTickService,
    marketPriceHistorySyncService,
  );

  await openPositionTracker.refresh();

  // Bootstrap price history for open non-crypto positions immediately at startup.
  marketPriceHistorySyncer.bootstrapTrackedPositions(openPositionTracker);

  connectionManager.setOnBookUpdate((assetId: string) => {
    void strategy.evaluateAll();
    percentPublisher.handleBookUpdate(assetId);
    marketTickRecorder.handleBookUpdate(assetId);
  });

  redisSub.subscribe('config-changed', 'backend-ready', ALGO_SELECTIONS_CHANGED_CHANNEL, SIMULATION_RESET_CHANNEL, (err: Error | null | undefined) => {
    if (err) log.error({ err }, 'redis subscribe failed');
  });

  let algoSelectionsSyncTimer: NodeJS.Timeout | null = null;
  let backendReadyDebounceTimer: NodeJS.Timeout | null = null;

  type MessageHandler = (channel: string, message: string) => void;

  const messageHandlers = new Map<string, MessageHandler>();

  messageHandlers.set(ALGO_SELECTIONS_CHANGED_CHANNEL, (_channel, _message) => {
    if (algoSelectionsSyncTimer) clearTimeout(algoSelectionsSyncTimer);
    algoSelectionsSyncTimer = setTimeout(() => {
      void syncBookSubscriptions(ds, connectionManager, true).catch((err) =>
        log.warn({ err }, 'algo selections changed — book sync failed'),
      );
    }, 2_000);
  });

  messageHandlers.set(SIMULATION_RESET_CHANNEL, (_channel, message) => {
    const payload = parseSimulationResetPayload(message);
    log.info(
      { sessionStartedAt: payload?.sessionStartedAt ?? null },
      'simulation-reset received — sim queues purged by backend',
    );
  });

  messageHandlers.set('config-changed', (_channel, _message) => {
    log.info('config changed — reloading risk config');
    void (async () => {
      try {
        await refreshWorkerContext({
          ds,
          connectionManager,
          userChannel,
          strategy,
          syncBooks: true,
          invalidateConfigCache: true,
          evaluateKillSwitch: true,
        });
      } catch (err) {
        log.error({ err }, 'config-changed refresh failed — worker continues');
      }
    })();
  });

  messageHandlers.set('backend-ready', (_channel, message) => {
    try {
      const payload = JSON.parse(message);
      log.info(
        { pid: payload.pid, at: payload.at },
        'backend ready signal received — will refresh trading context',
      );
    } catch {
      log.warn('malformed backend-ready payload');
    }
    if (backendReadyDebounceTimer) {
      clearTimeout(backendReadyDebounceTimer);
    }
    backendReadyDebounceTimer = setTimeout(() => {
      void refreshWorkerContext({
        ds,
        connectionManager,
        userChannel,
        strategy,
        syncBooks: true,
        invalidateConfigCache: true,
        evaluateKillSwitch: false,
      }).catch((err) => {
        log.warn({ err }, 'backend-ready context refresh failed');
      });
    }, 5_000);
  });

  redisSub.on('message', (channel: string, message: string) => {
    const handler = messageHandlers.get(channel);
    if (handler) {
      handler(channel, message);
    } else {
      log.warn({ channel }, 'unknown redis message channel');
    }
  });

  safeInterval(async () => {
    await redisPub.publish(
      'heartbeat',
      JSON.stringify({ worker: 'ok', at: Date.now() }),
    );
    await redisCmd.set('worker:heartbeat', String(Date.now()), 'EX', 60);
  }, HEARTBEAT_INTERVAL_MS, 'heartbeat');

  // Refresh the open-position index periodically so new/closed positions are picked up.
  // Also bootstrap price history for newly opened non-crypto positions.
  const openPositionRefreshTimer = safeInterval(async () => {
    await openPositionTracker.refresh();
    marketPriceHistorySyncer.bootstrapTrackedPositions(openPositionTracker);
  }, BOOK_SUBSCRIPTION_SYNC_MS, 'open-position-tracker-refresh');

  // Purge old market ticks once an hour.
  const marketTickPurgeTimer = safeInterval(async () => {
    const retentionDays = Math.max(1, config.marketTickRetentionDays);
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    await tickService.purgeOlderThan(retentionMs);
  }, 60 * 60 * 1000, 'market-tick-purge');

  // Purge old market price ticks (from Polymarket sync) once an hour.
  const marketPriceTickPurgeTimer = safeInterval(async () => {
    const retentionDays = config.marketPriceTickRetentionDays;
    if (retentionDays <= 0) return;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const deleted = await marketPriceTickService.deleteOlderThan(retentionMs);
    if (deleted > 0) {
      log.info({ deleted }, 'purged old market price ticks');
    }
  }, 60 * 60 * 1000, 'market-price-tick-purge');

  // Replace REST polling with periodic WebSocket subscription maintenance
  const subscriptionTimer = safeInterval(async () => {
    await syncBookSubscriptions(ds, connectionManager, true);
    await userChannel.syncSubscriptions();
  }, BOOK_SUBSCRIPTION_SYNC_MS, 'book-subscription-sync');

  strategy.startEvaluation(STRATEGY_EVAL_INTERVAL_MS);
  marketResolutionWatcher.startLoop(MARKET_RESOLUTION_LOOP_MS);
  redemption.startLoop(REDEMPTION_LOOP_MS);
  closingWatchdog.start(CLOSING_WATCHDOG_LOOP_MS);
  placingJanitor.start(workerConfig.PLACING_JANITOR_LOOP_MS ?? PLACING_JANITOR_LOOP_MS);
  reservationJanitor.start(RESERVATION_JANITOR_LOOP_MS);
  pendingEntryJanitor.start(PENDING_ENTRY_JANITOR_LOOP_MS);
  simRealismJanitor.start();
  marketPriceHistorySyncer.start().catch((err) => {
    log.warn({ err }, 'failed to start market price history syncer');
  });

  void orderQueueConsumer.startConsumer().catch((err) => {
    log.fatal({ err, queue: 'order-signals' }, 'queue consumer crashed');
    process.exit(1);
  });
  void algoOrderQueueConsumer.startConsumer().catch((err) => {
    log.fatal({ err, queue: 'algo-order-signals' }, 'queue consumer crashed');
    process.exit(1);
  });
  void weatherOrderQueueConsumer.startConsumer().catch((err) => {
    log.fatal({ err, queue: 'weather-order-signals' }, 'queue consumer crashed');
    process.exit(1);
  });
  void closeQueueConsumer.startConsumer().catch((err) => {
    log.fatal({ err, queue: 'close-signals' }, 'queue consumer crashed');
    process.exit(1);
  });
  void resultsQueueConsumer.startConsumer().catch((err) => {
    log.fatal({ err, queue: 'execution-results' }, 'queue consumer crashed');
    process.exit(1);
  });

  log.info('Polywatch worker started');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down...');
    if (algoSelectionsSyncTimer) clearTimeout(algoSelectionsSyncTimer);
    if (backendReadyDebounceTimer) clearTimeout(backendReadyDebounceTimer);
    if (marketResolvedDebounce) clearTimeout(marketResolvedDebounce);
    clearInterval(subscriptionTimer);
    clearInterval(openPositionRefreshTimer);
    clearInterval(marketTickPurgeTimer);
    clearInterval(marketPriceTickPurgeTimer);
    marketPriceHistorySyncer.stop();
    wsClient.disconnect();
    userChannel.disconnect();
    await redisCmd.quit();
    await redisPub.quit();
    await redisSub.quit();
    await redisOrderConsumer.quit();
    await redisAlgoOrderConsumer.quit();
    await redisWeatherOrderConsumer.quit();
    await redisCloseConsumer.quit();
    await redisResultsConsumer.quit();
    await ds.destroy();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});