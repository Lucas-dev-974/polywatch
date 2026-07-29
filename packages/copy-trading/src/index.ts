import pino from 'pino';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  CopyConfigService,
  GlobalConfigService,
  WatchlistService,
  createRedis,
  safeInterval,
  waitForBackendReady,
  RedisQueue,
  SIMULATION_RESET_CHANNEL,
  parseSimulationResetPayload,
  PolymarketConnectionManager,
  WORKER_QUEUES,
  type MoveEventDto,
  type OrderSignal,
} from '@polywatch/core';
import { config } from './config.js';
import { MoveDetector } from './processors/move-detector.js';
import { CopyProcessor } from './processors/copy-processor.js';
import { getPendingMoveAssetIds } from './polymarket/pending-move-assets.js';
import {
  BACKEND_READY_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
} from './constants.js';

const log = pino({ name: 'copy-trading' });

const COPY_TRADING_HEARTBEAT_KEY = 'copy-trading:heartbeat';

async function syncPendingBookSubscriptions(
  connectionManager: PolymarketConnectionManager,
): Promise<void> {
  const pending = getPendingMoveAssetIds();
  connectionManager.reconcileActiveAssets(pending);
  const wsClient = connectionManager.getWsClient();
  wsClient.reconcile(pending);
}

async function main() {
  const ds = await initializeDataSource(createDataSource());
  await assertDatabaseExists(ds);

  const copyConfigService = new CopyConfigService(ds);
  const globalConfigService = new GlobalConfigService(ds);
  const watchlistService = new WatchlistService(ds);

  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();
  const redisMoveConsumer = createRedis();

  const connectionManager = new PolymarketConnectionManager({
    wsUrl: config.wsUrl,
    clobApi: config.clobApi,
  });

  const moveQueue = new RedisQueue<MoveEventDto>(
    redisCmd,
    WORKER_QUEUES.MOVE_EVENTS,
    async () => {},
  );

  const orderQueue = new RedisQueue<OrderSignal>(
    redisCmd,
    WORKER_QUEUES.ORDER_SIGNALS,
    async () => {},
  );

  const moveDetector = new MoveDetector(ds, moveQueue, copyConfigService);
  const copyProcessor = new CopyProcessor(ds, connectionManager, orderQueue);

  const moveQueueConsumer = new RedisQueue<MoveEventDto>(
    redisMoveConsumer,
    WORKER_QUEUES.MOVE_EVENTS,
    (job) => copyProcessor.handle(job),
  );

  try {
    await waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS);
  } catch (err) {
    log.warn(
      { err },
      'backend-ready signal not received within timeout — continuing anyway',
    );
  }

  const watchlist = await watchlistService.loadAll();
  await moveDetector.markFirstPollPendingForNewTraders(
    watchlist.map((entry) => entry.traderAddress),
  );

  await moveQueueConsumer.recoverOrphans();
  await moveDetector.recoverOrphanMoves();

  const wsClient = connectionManager.getWsClient();
  try {
    await wsClient.connect();
    log.info('WebSocket order books connected');
  } catch (err) {
    log.warn({ err }, 'WebSocket connection failed — falling back to REST');
  }

  try {
    const copyConfig = await copyConfigService.getConfig();
    moveDetector.setIntervalMs(copyConfig.moveDetectorIntervalMs);
  } catch (err) {
    log.warn({ err }, 'failed to load move detector interval — using default');
  }

  moveDetector.startPolling();

  let shuttingDown = false;

  void moveQueueConsumer.startConsumer().catch((err) => {
    if (shuttingDown) {
      log.info({ err }, 'move-events consumer stopped during shutdown');
      return;
    }
    log.fatal({ err, queue: WORKER_QUEUES.MOVE_EVENTS }, 'queue consumer crashed');
    process.exit(1);
  });

  const heartbeatTimer = safeInterval(async () => {
    await redisPub.publish(
      'heartbeat',
      JSON.stringify({ service: 'copy-trading', at: Date.now() }),
    );
    await redisCmd.set(COPY_TRADING_HEARTBEAT_KEY, String(Date.now()), 'EX', 60);
  }, HEARTBEAT_INTERVAL_MS, 'heartbeat');

  const pendingBookSyncTimer = safeInterval(async () => {
    await syncPendingBookSubscriptions(connectionManager);
  }, 10_000, 'pending-book-sync');

  redisSub.subscribe('config-changed', SIMULATION_RESET_CHANNEL, (err) => {
    if (err) log.error({ err }, 'redis subscribe failed');
  });

  redisSub.on('message', (channel, message) => {
    if (shuttingDown) return;
    if (channel === 'config-changed') {
      log.info('config changed — reloading watchlist flags & copy config');
      void (async () => {
        WatchlistService.invalidateCache();
        CopyConfigService.invalidateConfigCache();
        GlobalConfigService.invalidateConfigCache();

        try {
          const copyConfig = await copyConfigService.getConfig();
          moveDetector.setIntervalMs(copyConfig.moveDetectorIntervalMs);
        } catch (err) {
          log.warn({ err }, 'failed to reload move detector interval');
        }

        try {
          const copyConfig = await copyConfigService.getConfig();
          const copyTradingEnabled = copyConfig.simCopyTradingEnabled || copyConfig.realCopyTradingEnabled;
          if (copyTradingEnabled && !moveDetector.isRunning()) {
            log.info('copy trading re-enabled — restarting move detector polling');
            moveDetector.startPolling();
          }
        } catch (err) {
          log.warn({ err }, 'failed to check copy-trading enabled state after config change');
        }

        try {
          await syncPendingBookSubscriptions(connectionManager);
        } catch (err) {
          log.warn({ err }, 'pending book sync after config-changed failed');
        }
      })();
      return;
    }

    if (channel === SIMULATION_RESET_CHANNEL) {
      const payload = parseSimulationResetPayload(message);
      log.info(
        { sessionStartedAt: payload?.sessionStartedAt ?? null },
        'simulation-reset received — copy-trading continues polling',
      );
    }
  });

  log.info('Polywatch copy-trading started');

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down...');
    moveDetector.stopPolling();
    clearInterval(heartbeatTimer);
    clearInterval(pendingBookSyncTimer);
    wsClient.disconnect();
    const safeQuit = (r: typeof redisCmd) => r.quit().catch(() => {});
    await safeQuit(redisCmd);
    await safeQuit(redisPub);
    await safeQuit(redisSub);
    await safeQuit(redisMoveConsumer);
    await ds.destroy().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
