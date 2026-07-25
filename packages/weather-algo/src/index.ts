import pino from 'pino';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  RiskService,
  createWeatherSelectionServices,
  WeatherAutoTrackService,
  WeatherForecastService,
  createRedis,
  safeInterval,
  waitForBackendReady,
  RedisQueue,
  type OrderSignal,
  WORKER_QUEUES,
  ReservationService,
  SimulationService,
  MarketService,
  PolymarketConnectionManager,
} from '@polywatch/core';
import { config } from './config.js';
import { seedWeatherAlgoWatchlistEntry } from './watchlist-seed.js';
import { WeatherSelectionLoader } from './selection-loader.js';
import {
  WeatherStrategyRegistry,
  WeatherForecastStrategy,
  type WeatherSignal,
} from './strategy/registry.js';
import { WeatherStrategyRunner } from './strategy/strategy-runner.js';
import { WeatherAlgoRuntimeStatusPublisher } from './runtime-status.js';
import { runWeatherEntryPipeline } from './processors/weather-entry-pipeline.js';

const log = pino({ name: 'weather-algo' });

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKEND_READY_TIMEOUT_MS = 60_000;

async function main() {
  // 1. Initialize DataSource
  const ds = await initializeDataSource(createDataSource());
  await assertDatabaseExists(ds);

  // 2. Seed weather-algo watchlist entry
  const watchlistId = await seedWeatherAlgoWatchlistEntry(ds);
  log.info({ watchlistId }, 'weather-algo watchlist entry ready');

  // 3. Create services
  const riskService = new RiskService(ds);
  const { selectionService } = createWeatherSelectionServices(ds);
  const forecastService = new WeatherForecastService(ds);
  const marketService = new MarketService(ds);
  const reservationService = new ReservationService(ds);
  const simulationService = new SimulationService(ds);

  // 4. Create Redis connections
  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();

  // 5. Create SelectionLoader
  const selectionLoader = new WeatherSelectionLoader(selectionService, redisSub);

  // 6. Create StrategyRegistry
  const registry = new WeatherStrategyRegistry();
  registry.register(new WeatherForecastStrategy());

  // 7. Create connection manager for live prices
  const connectionManager = new PolymarketConnectionManager({
    wsUrl: config.wsUrl,
    clobApi: config.clobApi,
  });

  // 8. Create order queue
  const orderQueue = new RedisQueue<OrderSignal>(
    redisCmd,
    WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
    async () => {},
  );

  // 9. Wait for backend
  try {
    await waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS);
  } catch (err) {
    log.warn({ err }, 'backend-ready signal not received within timeout — continuing anyway');
  }

  // 10. Load RiskConfig
  const riskConfig = await riskService.getConfig();
  if (!riskConfig.weatherAlgoEnabled) {
    log.warn('weather-algo is disabled in risk config — starting in standby mode');
  } else {
    log.info('weather-algo enabled in risk config');
  }

  // 11. Load selections
  await selectionLoader.load();
  selectionLoader.subscribeToConfigChanges();
  selectionLoader.startPeriodicRefresh();

  // 12. Create entry pipeline
  const onSignal = async (signal: WeatherSignal): Promise<boolean> => {
    const result = await runWeatherEntryPipeline({
      signal,
      risk: riskConfig,
      watchlistId,
      connectionManager,
      reservationService,
      simulationService,
      marketService,
      orderQueue,
      redisCmd,
      ds,
      backendUrl: config.backendUrl,
      serviceToken: config.serviceToken,
    });

    if (result === null) {
      log.info(
        { conditionId: signal.conditionId, eventSlug: signal.eventSlug, edge: signal.edge },
        'weather signal accepted',
      );
      return true;
    }

    log.warn(
      { conditionId: signal.conditionId, reason: result },
      'weather signal rejected by entry pipeline',
    );
    return false;
  };

  // 13. Create StrategyRunner
  const runtimeStatus = new WeatherAlgoRuntimeStatusPublisher(redisCmd);
  const strategyRunner = new WeatherStrategyRunner({
    ds,
    selectionService,
    forecastService,
    registry,
    redisCmd,
    onSignal,
    pollMs: config.pollMs,
    forecastCacheTtlMs: config.forecastCacheTtlMs,
    runtimeStatus,
  });
  strategyRunner.setRiskConfig(riskConfig);

  // 14. Start evaluation loop
  strategyRunner.start();

  // 15. Heartbeat
  const heartbeatTimer = safeInterval(
    async () => {
      await redisPub.publish(
        'heartbeat',
        JSON.stringify({ service: 'weather-algo', at: Date.now() }),
      );
      await redisCmd.set('weather-algo:heartbeat', String(Date.now()), 'EX', 60);
    },
    HEARTBEAT_INTERVAL_MS,
    'weather-algo:heartbeat',
  );

  // 16. Subscribe to config-changed
  redisSub.subscribe('config-changed', (err: Error | null | undefined) => {
    if (err) log.error({ err }, 'failed to subscribe to config-changed channel');
  });

  redisSub.on('message', (channel: string) => {
    if (channel !== 'config-changed') return;
    log.info('config-changed received — reloading selections and risk config');
    void (async () => {
      try {
        await selectionLoader.reload();
        RiskService.invalidateConfigCache();
        const refreshed = await riskService.getConfig();
        log.info({ weatherAlgoEnabled: refreshed.weatherAlgoEnabled }, 'risk config reloaded');
        strategyRunner.setRiskConfig(refreshed);
      } catch (err) {
        log.error({ err }, 'failed to reload on config-changed');
      }
    })();
  });

  // 17. Connect to Polymarket WS
  try {
    await connectionManager.getWsClient().connect();
    log.info('connected to Polymarket websocket');
  } catch (err) {
    log.warn({ err }, 'failed to connect to Polymarket websocket — continuing with REST polling');
  }

  log.info('Polywatch weather-algo started');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down...');
    strategyRunner.stop();
    clearInterval(heartbeatTimer);
    await selectionLoader.stop();
    try {
      await connectionManager.getWsClient().disconnect();
    } catch {
      // ignore
    }
    await redisCmd.quit();
    await redisPub.quit();
    await redisSub.quit();
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