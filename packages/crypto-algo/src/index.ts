import pino from 'pino';
import type { Redis } from 'ioredis';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  CryptoConfigService,
  GlobalConfigService,
  MarketService,
  AlgoAutoTrackService,
  createAlgoSelectionServices,
  ReservationService,
  SimulationService,
  createRedis,
  safeInterval,
  waitForBackendReady,
  RedisQueue,
  ALGO_SL_QUOTA_INVALIDATE_CHANNEL,
  ALGO_REENTRY_FILL_CHANNEL,
  SIMULATION_RESET_CHANNEL,
  parseSimulationResetPayload,
  publishAlgoSelectionsChanged,
  type OrderSignal,
  PolymarketConnectionManager,
  createBackendClient,
  resolvePollMs,
  resolveWsDebounceMs,
  resolvePriceTickRefQty,
  resolveTickIntervalMs,
  resolveTickRetentionHours,
  type CryptoConfig,
  type GlobalConfig,
  WORKER_QUEUES,
} from '@polywatch/core';
import { config } from './config.js';
import { seedCryptoAlgoWatchlistEntry } from './watchlist-seed.js';
import { SelectionLoader } from './selection-loader.js';
import { StrategyRegistry, NaiveMomentumStrategy, type AlgoSignal } from './strategy/index.js';
import { StrategyRunner } from './strategy/strategy-runner.js';
import { CryptoAlgoPriceFeed } from './price-feed.js';
import { runAlgoEntryPipeline } from './processors/algo-entry-pipeline.js';
import { runMarketJanitorCycle, resolveMarketJanitorIntervalMs } from './auto-track-janitor.js';
import { AlgoMarketPercentPublisher } from './algo-percent-publisher.js';
import { AlgoChartTickPublisher } from './algo-chart-tick-publisher.js';
import { CryptoAlgoRuntimeStatusPublisher } from './runtime-status.js';
import { MarketSurveillanceRecorder } from './market-surveillance-recorder.js';
import { PriceTickRecorder } from './price-tick-recorder.js';
import { SignalStateRegistry } from './signal-state-registry.js';
import { PositionContextCache } from './position-context-cache.js';
import { buildSurveillanceTargets } from './surveillance-targets.js';
import { startSurveillanceJanitor } from './surveillance-janitor.js';

const log = pino({ name: 'crypto-algo' });

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKEND_READY_TIMEOUT_MS = 60_000;

function applyCryptoAlgoRiskTunables(
  cryptoConfig: CryptoConfig,
  strategyRunner: StrategyRunner,
  priceFeed: CryptoAlgoPriceFeed,
  priceTickRecorder: PriceTickRecorder,
): void {
  strategyRunner.applyRiskTunables(cryptoConfig);
  strategyRunner.reconfigurePollMs(resolvePollMs(cryptoConfig, config.pollMs));
  priceFeed.setDebounceMs(resolveWsDebounceMs(cryptoConfig));
  priceTickRecorder.configure({
    tickIntervalMs: resolveTickIntervalMs(cryptoConfig),
    retentionHours: resolveTickRetentionHours(cryptoConfig),
    refQty: resolvePriceTickRefQty(cryptoConfig),
  });
}

async function main() {
  // 1. Initialize DataSource (PostgreSQL via DATABASE_URL)
  const ds = await initializeDataSource(createDataSource());

  // 2. Assert database exists (schema/migrations applied)
  await assertDatabaseExists(ds);

  // 3. Seed crypto-algo watchlist entry
  const watchlistId = await seedCryptoAlgoWatchlistEntry(ds);
  log.info({ watchlistId }, 'crypto-algo watchlist entry ready');

  // 4. Create services
  const cryptoConfigService = new CryptoConfigService(ds);
  const globalConfigService = new GlobalConfigService(ds);
  const { marketService, selectionService: algoSelectionService } =
    createAlgoSelectionServices(ds);
  const autoTrackService = new AlgoAutoTrackService(ds);
  const reservationService = new ReservationService(ds);
  const simulationService = new SimulationService(ds);

  // 5. Create Redis connections (separate roles — subscribe mode blocks commands)
  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();

  // 6. Create SelectionLoader
  const selectionLoader = new SelectionLoader(algoSelectionService, redisSub);

  // 7. Create StrategyRegistry and register strategies
  const registry = new StrategyRegistry();
  registry.register(new NaiveMomentumStrategy());

  // 8. Create real connection manager (for WebSocket)
  const connectionManager = new PolymarketConnectionManager({
    wsUrl: config.wsUrl,
    clobApi: config.clobApi,
  });

  // 9. Create order queue
  const orderQueue = new RedisQueue<OrderSignal>(
    redisCmd,
    WORKER_QUEUES.ALGO_ORDER_SIGNALS,
    async () => {},
  );

  // 10. Create price feed for real-time WebSocket updates
  const priceFeed = new CryptoAlgoPriceFeed();
  priceFeed.setConnectionManager(connectionManager);

  // 11. Wait for backend to be ready before proceeding
  try {
    await waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS);
  } catch (err) {
    log.warn(
      { err },
      'backend-ready signal not received within timeout — continuing anyway',
    );
  }

  // 12. Load CryptoConfig and check crypto-algo kill switch
  const cryptoConfig = await cryptoConfigService.getConfig();
  if (!cryptoConfig.cryptoAlgoEnabled) {
    log.warn('crypto-algo is disabled in crypto config — starting in standby mode');
  } else {
    log.info('crypto-algo enabled in crypto config');
  }

  // 13. Load selections, subscribe to config changes, start periodic refresh
  await selectionLoader.load();
  await algoSelectionService.ensureMarketsForEnabledSelections();
  selectionLoader.subscribeToConfigChanges();
  selectionLoader.startPeriodicRefresh();

  const signalRegistry = new SignalStateRegistry();
  const positionCache = new PositionContextCache(ds);

  const chartTickPublisher = new AlgoChartTickPublisher(
    config.backendUrl,
    config.serviceToken,
  );

  const priceTickRecorder = new PriceTickRecorder(ds, {
    priceFeed,
    connectionManager,
    refQty: config.priceTickRefQty,
    signalRegistry,
    positionCache,
    chartTickPublisher,
  });

  // 14. Create the onSignal callback that runs the entry pipeline
  const onSignal = async (signal: AlgoSignal): Promise<boolean> => {
    const cryptoConfig = await cryptoConfigService.getConfig();
    const globalConfig = await globalConfigService.getConfig();
    const result = await runAlgoEntryPipeline({
      signal,
      risk: cryptoConfig,
      realTradingEnabled: globalConfig.realTradingEnabled,
      watchlistId,
      connectionManager,
      reservationService,
      simulationService,
      marketService,
      orderQueue,
      ds,
      redisCmd,
      backendUrl: config.backendUrl,
      serviceToken: config.serviceToken,
    });
    if (result !== null) {
      log.info(
        { conditionId: signal.conditionId, reason: result },
        'algo entry pipeline skipped signal',
      );
      return false;
    }

    signalRegistry.recordSignal(signal);
    log.info(
      { conditionId: signal.conditionId },
      'algo entry pipeline processed signal',
    );
    await positionCache.refresh(priceTickRecorder.getActiveConditionIds());
    return true;
  };

  // 15. Create StrategyRunner with WebSocket integration
  const runtimeStatus = new CryptoAlgoRuntimeStatusPublisher(redisCmd);
  const strategyRunner = new StrategyRunner(
    selectionLoader,
    registry,
    cryptoConfigService,
    marketService,
    ds,
    algoSelectionService,
    onSignal,
    config.gammaApi,
    undefined,
    runtimeStatus,
  );

  // 16. Set up WebSocket price feed integration
  strategyRunner.setPriceFeed(priceFeed);
  strategyRunner.setRedis(redisCmd);
  strategyRunner.setOnAbstain((conditionId, reason, detail) => {
    signalRegistry.recordAbstain(conditionId, reason, detail);
  });

  applyCryptoAlgoRiskTunables(cryptoConfig, strategyRunner, priceFeed, priceTickRecorder);

  // 16b. Create percent publisher for live market updates
  const percentPublisher = new AlgoMarketPercentPublisher(
    connectionManager,
    config.backendUrl,
    config.serviceToken,
  );
  connectionManager.setOnBookUpdate((assetId: string) => {
    priceFeed.dispatchBookUpdate(assetId);
    percentPublisher.handleBookUpdate(assetId);
  });

  const surveillanceRecorder = new MarketSurveillanceRecorder(ds, priceFeed, {
    onOpenCaptured: (conditionId) => {
      void priceTickRecorder.addMarket(conditionId);
    },
  });

  const refreshSurveillanceTargets = async (): Promise<void> => {
    const targets = await buildSurveillanceTargets(autoTrackService, selectionLoader);
    await surveillanceRecorder.refresh(targets);
    // Demarrer les ticks des la decouverte, sans attendre le snapshot d'ouverture
    for (const target of targets) {
      void priceTickRecorder.addMarket(target.conditionId);
    }
    await priceTickRecorder.refreshActiveMarkets();
    await positionCache.refresh(priceTickRecorder.getActiveConditionIds());
  };

  const onMarketResolved = async (conditionId: string): Promise<void> => {
    await marketService.fetchAndPersist(conditionId);
    await surveillanceRecorder.captureOnResolved(conditionId, { forceImmediate: true });
    priceTickRecorder.removeMarket(conditionId);
  };

  // Create backend client for notifying frontend of market changes
  const { postBackendJson } = createBackendClient({
    backendUrl: config.backendUrl,
    serviceToken: config.serviceToken,
  });

  // 17. Connect WebSocket and subscribe to active markets
  try {
    const activeConditionIds = selectionLoader
      .getActiveSelections()
      .filter(s => s.enabled)
      .map(s => s.conditionId);

    await connectionManager.getWsClient().connect();
    await strategyRunner.connectWebSocket(connectionManager, activeConditionIds);

    log.info({ count: activeConditionIds.length }, 'WebSocket price feed connected');
  } catch (err) {
    log.warn({ err }, 'WebSocket connection failed — falling back to polling mode');
    // Continue without WebSocket - polling will still work
  }

  // 18. Start the strategy evaluation loop (polling fallback)
  strategyRunner.start(resolvePollMs(cryptoConfig, config.pollMs));
  log.info({ pollMs: resolvePollMs(cryptoConfig, config.pollMs) }, 'strategy runner started');

  let marketJanitorTimer: NodeJS.Timeout | null = null;

  const syncSelectionsAfterMarketChange = async (): Promise<void> => {
    await selectionLoader.reload();
    const activeConditionIds = selectionLoader
      .getActiveSelections()
      .filter((s) => s.enabled)
      .map((s) => s.conditionId);
    strategyRunner.updateWebSocketSubscriptions(activeConditionIds);
    await refreshSurveillanceTargets();

    try {
      await postBackendJson('/api/algo/markets/notify-changed', {});
      log.info('notified backend of algo markets change');
    } catch (err) {
      log.warn({ err }, 'failed to notify backend of algo markets change');
    }
  };

  strategyRunner.setOnSelectionResolved(async (conditionId) => {
    await onMarketResolved(conditionId);
    const { added } = await autoTrackService.syncAfterMarketResolved(
      algoSelectionService,
      conditionId,
    );
    log.info({ conditionId, added }, 'auto-track sync after market resolved');
    await syncSelectionsAfterMarketChange();
  });

  const runMarketJanitorTick = async (): Promise<void> => {
    try {
      const { disabled, disabledIds, added } = await runMarketJanitorCycle(
        autoTrackService,
        algoSelectionService,
      );
      strategyRunner.runMaintenanceCleanup();

      for (const conditionId of disabledIds) {
        try {
          await onMarketResolved(conditionId);
        } catch (err) {
          log.warn({ err, conditionId }, 'surveillance capture failed after janitor disable');
        }
      }

      if (disabled > 0 || added > 0) {
        log.info({ disabled, added }, 'market janitor applied selection changes');
        await syncSelectionsAfterMarketChange();
        await publishAlgoSelectionsChanged(redisPub, { disabled, added });
      }
    } catch (err) {
      log.error({ err }, 'market janitor tick failed');
    }
  };

  const scheduleMarketJanitor = async (): Promise<void> => {
    if (marketJanitorTimer) {
      clearInterval(marketJanitorTimer);
      marketJanitorTimer = null;
    }

    const rules = await autoTrackService.loadAllEnabled();
    const intervalMs = resolveMarketJanitorIntervalMs(rules);
    log.info({ intervalMs, ruleCount: rules.length }, 'market janitor scheduled');

    marketJanitorTimer = safeInterval(
      () => runMarketJanitorTick(),
      intervalMs,
      'crypto-algo:market-janitor',
    );
  };

  // 19. Unified market janitor: resolve expired markets, then discover new ones
  await scheduleMarketJanitor();
  void runMarketJanitorTick();
  await refreshSurveillanceTargets();

  const surveillanceRefreshTimer = safeInterval(
    async () => {
      await refreshSurveillanceTargets();
    },
    60_000,
    'crypto-algo:surveillance-refresh',
  );

  // 19b. Janitor: mark surveillance snapshots as unresolved if their close
  // never arrives, with fallback to the local markets table.
  const stopSurveillanceJanitor = startSurveillanceJanitor(ds);

  // 19c. Price tick cleanup: configurable via CryptoConfig
  let priceTickCleanupTimer: NodeJS.Timeout | null = null;

  if (cryptoConfig.cryptoAlgoPriceTickCleanupEnabled) {
    const intervalMs = (cryptoConfig.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60) * 60 * 1000;
    priceTickCleanupTimer = safeInterval(
      () => priceTickRecorder.cleanupOldTicks(),
      intervalMs,
      'crypto-algo:price-tick-cleanup',
    );
    log.info(
      { intervalMinutes: cryptoConfig.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60 },
      'price tick cleanup started',
    );
  } else {
    log.info('price tick cleanup disabled via crypto config');
  }

  const positionContextRefreshTimer = safeInterval(
    async () => {
      await positionCache.refresh(priceTickRecorder.getActiveConditionIds());
    },
    5_000,
    'crypto-algo:position-context-refresh',
  );

  // 21. Heartbeat: publish every 30s
  const heartbeatTimer = safeInterval(
    async () => {
      await redisPub.publish(
        'heartbeat',
        JSON.stringify({ service: 'crypto-algo', at: Date.now() }),
      );
      await redisCmd.set(
        'crypto-algo:heartbeat',
        String(Date.now()),
        'EX',
        60,
      );
    },
    HEARTBEAT_INTERVAL_MS,
    'crypto-algo:heartbeat',
  );

  // 21. Subscribe to config-changed on redisSub — reload selections + risk config
  redisSub.subscribe('config-changed', ALGO_SL_QUOTA_INVALIDATE_CHANNEL, ALGO_REENTRY_FILL_CHANNEL, SIMULATION_RESET_CHANNEL, (err: Error | null | undefined) => {
    if (err) log.error({ err }, 'failed to subscribe to config-changed channel');
  });

  redisSub.on('message', (channel: string, message?: string) => {
    if (channel === ALGO_SL_QUOTA_INVALIDATE_CHANNEL) {
      try {
        const payload = JSON.parse(message ?? '') as {
          conditionId?: string;
          mode?: 'sim' | 'real';
        };
        if (payload.conditionId) {
          strategyRunner.invalidateSlQuotaCache(payload.conditionId, payload.mode);
        }
      } catch (err) {
        log.warn({ err, message }, 'malformed algo SL quota invalidate payload');
      }
      return;
    }

    if (channel === ALGO_REENTRY_FILL_CHANNEL) {
      try {
        const payload = JSON.parse(message ?? '') as {
          conditionId?: string;
          outcome?: string;
          filledAtMs?: number;
          positionId?: number;
          windowMs?: number;
        };
        if (payload.conditionId && payload.outcome) {
          strategyRunner.recordReEntryOnFill(
            payload.conditionId,
            payload.outcome,
            payload.filledAtMs ?? Date.now(),
            payload.positionId,
            payload.windowMs,
          );
        }
      } catch (err) {
        log.warn({ err, message }, 'malformed algo re-entry fill payload');
      }
      return;
    }

    if (channel === SIMULATION_RESET_CHANNEL) {
      const payload = parseSimulationResetPayload(message ?? '');
      log.info(
        { sessionStartedAt: payload?.sessionStartedAt ?? null },
        'simulation-reset received — sim session rotated',
      );
      return;
    }

    if (channel !== 'config-changed') return;
    log.info('config-changed received — reloading selection loader and crypto config');
    void (async () => {
      try {
        await selectionLoader.reload();
        await algoSelectionService.ensureMarketsForEnabledSelections();

        // Update WebSocket subscriptions
        const activeConditionIds = selectionLoader
          .getActiveSelections()
          .filter(s => s.enabled)
          .map(s => s.conditionId);
        strategyRunner.updateWebSocketSubscriptions(activeConditionIds);

        await scheduleMarketJanitor();
        await refreshSurveillanceTargets();
      } catch (err) {
        log.error({ err }, 'failed to reload selection loader on config-changed');
      }
      try {
        CryptoConfigService.invalidateConfigCache();
        const refreshed = await cryptoConfigService.getConfig();
        log.info(
          { cryptoAlgoEnabled: refreshed.cryptoAlgoEnabled },
          'crypto config reloaded',
        );

        applyCryptoAlgoRiskTunables(
          refreshed,
          strategyRunner,
          priceFeed,
          priceTickRecorder,
        );

        // Reconfigure price tick cleanup timer if settings changed
        if (priceTickCleanupTimer) {
          clearInterval(priceTickCleanupTimer);
          priceTickCleanupTimer = null;
        }
        if (refreshed.cryptoAlgoPriceTickCleanupEnabled) {
          const intervalMs = (refreshed.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60) * 60 * 1000;
          priceTickCleanupTimer = safeInterval(
            () => priceTickRecorder.cleanupOldTicks(),
            intervalMs,
            'crypto-algo:price-tick-cleanup',
          );
          log.info(
            { intervalMinutes: refreshed.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60 },
            'price tick cleanup reconfigured',
          );
        } else {
          log.info('price tick cleanup disabled via config-changed');
        }
      } catch (err) {
        log.warn({ err }, 'failed to reload crypto config on config-changed');
      }
    })();
  });

  log.info('Polywatch crypto-algo started (WebSocket + polling hybrid mode)');

  // 22. Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down...');
    if (marketJanitorTimer) clearInterval(marketJanitorTimer);
    clearInterval(heartbeatTimer);
    clearInterval(surveillanceRefreshTimer);
    stopSurveillanceJanitor();
    priceTickRecorder.shutdown();
    if (priceTickCleanupTimer) clearInterval(priceTickCleanupTimer);
    clearInterval(positionContextRefreshTimer);
    positionCache.clear();
    signalRegistry.clear();
    surveillanceRecorder.shutdown();
    strategyRunner.stop();
    try {
      await selectionLoader.stop();
    } catch (err) {
      log.warn({ err }, 'failed to stop selection loader');
    }
    const safeQuit = (r: Redis) => r.quit().catch(() => {});
    await safeQuit(redisCmd);
    await safeQuit(redisPub);
    await safeQuit(redisSub);
    await ds.destroy().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});