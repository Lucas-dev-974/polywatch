import pino from 'pino';
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
  ALGO_POSITION_CLOSED_CHANNEL,
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
  PostEntryMidSample,
} from '@polywatch/core';
import { config } from './config.js';
import { createShutdownHandler } from './shutdown.js';
import { seedCryptoAlgoWatchlistEntry } from './watchlist-seed.js';
import { SelectionLoader } from './selection-loader.js';
import { StrategyRegistry, type AlgoSignal } from './strategy/index.js';
import { registerBuiltinStrategies } from './strategy/register-builtin-strategies.js';
import { StrategyRunner } from './strategy/strategy-runner.js';
import { CryptoAlgoPriceFeed } from './price-feed.js';
import { runAlgoEntryPipeline } from './processors/algo-entry-pipeline.js';
import type { SlQuotaState } from './strategy/sl-quota.js';
import { runMarketJanitorCycle, resolveMarketJanitorIntervalMs } from './auto-track-janitor.js';
import { AlgoMarketPercentPublisher } from './algo-percent-publisher.js';
import { AlgoChartTickPublisher } from './algo-chart-tick-publisher.js';
import { CryptoAlgoRuntimeStatusPublisher } from './runtime-status.js';
import { MarketSurveillanceRecorder } from './market-surveillance-recorder.js';
import { PriceTickRecorder } from './price-tick-recorder.js';
import { SignalStateRegistry } from './signal-state-registry.js';
import { PositionContextCache } from './position-context-cache.js';
import { buildSurveillanceTargets } from './surveillance-targets.js';
import {
  cancelPostEntryMidTimersForPosition,
  clearPostEntryMidTimers,
  POST_ENTRY_MID_RETENTION_MS,
  schedulePostEntryMidLog,
} from './post-entry-mid-logger.js';
import { startSurveillanceJanitor } from './surveillance-janitor.js';

const log = pino({ name: 'crypto-algo' });

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKEND_READY_TIMEOUT_MS = 60_000;

async function applyCryptoAlgoRiskTunables(
  cryptoConfig: CryptoConfig,
  strategyRunner: StrategyRunner,
  priceFeed: CryptoAlgoPriceFeed,
  priceTickRecorder: PriceTickRecorder,
): Promise<void> {
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

  // 7. Create StrategyRegistry and auto-register built-ins (Phase 2.4)
  const registry = new StrategyRegistry();
  registerBuiltinStrategies(registry);

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
  const slQuotaCache = new Map<string, SlQuotaState>();
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
      clobApi: config.clobApi,
      slQuotaCache,
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
  strategyRunner.setSlQuotaCache(slQuotaCache);
  strategyRunner.setOnAbstain((conditionId, reason, detail) => {
    signalRegistry.recordAbstain(conditionId, reason, detail);
  });

  await applyCryptoAlgoRiskTunables(cryptoConfig, strategyRunner, priceFeed, priceTickRecorder);

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
  const { postBackendJson, postBackendAlert } = createBackendClient({
    backendUrl: config.backendUrl,
    serviceToken: config.serviceToken,
  });

  // Wire operator alert sink for re-entry Redis mirror failures (UI banner).
  const alertSink = (message: string) => {
    postBackendAlert('/api/internal/alerts', { type: 'warning', message });
  };
  strategyRunner.setReEntryAlertSink(alertSink);

  // Wire operator alert sink for high WS/Gamma price deviation (F3).
  const naiveMomentum = registry.getStrategy('naive-momentum');
  if (naiveMomentum && 'setAlertSink' in naiveMomentum) {
    (naiveMomentum as { setAlertSink: (s: (m: string) => void) => void }).setAlertSink(alertSink);
  }

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

  let surveillanceRefreshTimer: NodeJS.Timeout | null = null;
  surveillanceRefreshTimer = safeInterval(
    async () => {
      await refreshSurveillanceTargets();
    },
    60_000,
    'crypto-algo:surveillance-refresh',
  );

  // 19b. Janitor: mark surveillance snapshots as unresolved if their close
  // never arrives, with fallback to the local markets table.
  const stopSurveillanceJanitor = startSurveillanceJanitor(ds);

  // 19c. Price tick cleanup: DISABLED per user request (was configurable via CryptoConfig)
  // Previously: if (cryptoConfig.cryptoAlgoPriceTickCleanupEnabled) { ... }
  // Manual cleanup still available via API if needed.
  let shuttingDown = false;

  let positionContextRefreshTimer: NodeJS.Timeout | null = null;
  positionContextRefreshTimer = safeInterval(
    async () => {
      await positionCache.refresh(priceTickRecorder.getActiveConditionIds());
    },
    5_000,
    'crypto-algo:position-context-refresh',
  );

  /**
   * Master toggle for market recording & listening (cryptoAlgoRecordingEnabled).
   * When disabled: stop WebSocket subscription, polling evaluation, price tick
   * recording and surveillance open/close capture. When enabled: resume all of
   * them on the currently active markets. Existing data is never purged.
   */
  const setRecordingAndListening = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      try {
        if (!strategyRunner.isWsConnected()) {
          await connectionManager.getWsClient().connect();
          const activeConditionIds = selectionLoader
            .getActiveSelections()
            .filter((s) => s.enabled)
            .map((s) => s.conditionId);
          await strategyRunner.connectWebSocket(connectionManager, activeConditionIds);
        }
      } catch (err) {
        log.warn({ err }, 'failed to resume WS on recording toggle — polling continues');
      }
      strategyRunner.start(resolvePollMs(cryptoConfig, config.pollMs));
      priceTickRecorder.resume();
      surveillanceRecorder.resume();
      if (!surveillanceRefreshTimer) {
        surveillanceRefreshTimer = safeInterval(
          async () => {
            await refreshSurveillanceTargets();
          },
          60_000,
          'crypto-algo:surveillance-refresh',
        );
      }
      if (!positionContextRefreshTimer) {
        positionContextRefreshTimer = safeInterval(
          async () => {
            await positionCache.refresh(priceTickRecorder.getActiveConditionIds());
          },
          5_000,
          'crypto-algo:position-context-refresh',
        );
      }
      await scheduleMarketJanitor();
      await refreshSurveillanceTargets();
      log.info('crypto-algo recording & listening resumed');
    } else {
      strategyRunner.stop();
      priceTickRecorder.pause();
      surveillanceRecorder.pause();
      if (marketJanitorTimer) {
        clearInterval(marketJanitorTimer);
        marketJanitorTimer = null;
      }
      if (surveillanceRefreshTimer) {
        clearInterval(surveillanceRefreshTimer);
        surveillanceRefreshTimer = null;
      }
      if (positionContextRefreshTimer) {
        clearInterval(positionContextRefreshTimer);
        positionContextRefreshTimer = null;
      }
      log.info('crypto-algo recording & listening paused');
    }
  };

  if (!cryptoConfig.cryptoAlgoRecordingEnabled) {
    await setRecordingAndListening(false);
  }

  // Retention: drop post-entry mid samples older than 14 days (hourly).
  const postEntryMidCleanupTimer = safeInterval(
    async () => {
      try {
        const cutoff = Date.now() - POST_ENTRY_MID_RETENTION_MS;
        await ds
          .getRepository(PostEntryMidSample)
          .createQueryBuilder()
          .delete()
          .where('sampled_at_ms < :cutoff', { cutoff: String(cutoff) })
          .execute();
      } catch (err) {
        log.warn({ err }, 'post-entry mid sample cleanup failed');
      }
    },
    60 * 60_000,
    'crypto-algo:post-entry-mid-cleanup',
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
  redisSub.subscribe(
    'config-changed',
    ALGO_SL_QUOTA_INVALIDATE_CHANNEL,
    ALGO_REENTRY_FILL_CHANNEL,
    ALGO_POSITION_CLOSED_CHANNEL,
    SIMULATION_RESET_CHANNEL,
    (err: Error | null | undefined) => {
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
          schedulePostEntryMidLog({
            conditionId: payload.conditionId,
            outcome: payload.outcome,
            positionId: payload.positionId,
            filledAtMs: payload.filledAtMs,
            priceFeed,
            onSample: async (sample) => {
              await ds.getRepository(PostEntryMidSample).save({
                conditionId: payload.conditionId!,
                outcome: payload.outcome!,
                positionId: payload.positionId ?? null,
                filledAtMs: String(payload.filledAtMs ?? Date.now()),
                offsetMs: sample.offsetMs,
                upMid: sample.upMid,
                downMid: sample.downMid,
                sampledAtMs: String(sample.sampledAtMs),
              });
            },
          });
        }
      } catch (err) {
        log.warn({ err, message }, 'malformed algo re-entry fill payload');
      }
      return;
    }

    if (channel === ALGO_POSITION_CLOSED_CHANNEL) {
      try {
        const payload = JSON.parse(message ?? '') as { positionId?: number };
        if (typeof payload.positionId === 'number') {
          cancelPostEntryMidTimersForPosition(payload.positionId);
        }
      } catch (err) {
        log.warn({ err, message }, 'malformed algo-position-closed payload');
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

        await applyCryptoAlgoRiskTunables(
          refreshed,
          strategyRunner,
          priceFeed,
          priceTickRecorder,
        );

        await setRecordingAndListening(refreshed.cryptoAlgoRecordingEnabled);

        // NOTE: price tick cleanup auto-purge disabled per user request — no reconfiguration needed
      } catch (err) {
        log.warn({ err }, 'failed to reload crypto config on config-changed');
      }
    })();
  });

  log.info('Polywatch crypto-algo started (WebSocket + polling hybrid mode)');

  // 22. Graceful shutdown
  const shutdown = createShutdownHandler({
    log,
    clearProcessTimers: () => {
      shuttingDown = true;
      if (marketJanitorTimer) clearInterval(marketJanitorTimer);
      clearInterval(heartbeatTimer);
      if (surveillanceRefreshTimer) clearInterval(surveillanceRefreshTimer);
      stopSurveillanceJanitor();
      clearPostEntryMidTimers();
      priceTickRecorder.shutdown();
      // NOTE: priceTickCleanupTimer removed (auto purge disabled)
      if (positionContextRefreshTimer) clearInterval(positionContextRefreshTimer);
      clearInterval(postEntryMidCleanupTimer);
      positionCache.clear();
      signalRegistry.clear();
      surveillanceRecorder.shutdown();
    },
    strategyRunner,
    selectionLoader,
    redisClients: [redisCmd, redisPub, redisSub],
    dataSource: ds,
  });

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