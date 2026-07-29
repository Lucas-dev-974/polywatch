import pino from 'pino';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  WeatherConfigService,
  GlobalConfigService,
  createWeatherSelectionServices,
  WeatherAutoTrackService,
  WeatherForecastService,
  WeatherPositionForecastService,
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
import {
  WeatherStrategyRegistry,
  WeatherForecastStrategy,
  type WeatherSignal,
} from './strategy/registry.js';
import { WeatherStrategyRunner } from './strategy/strategy-runner.js';
import { WeatherAlgoRuntimeStatusPublisher } from './runtime-status.js';
import { runWeatherEntryPipeline } from './processors/weather-entry-pipeline.js';
import { WeatherExitEvaluator } from './processors/weather-exit-evaluator.js';
import { runWeatherAutoTrackJanitorCycle } from './auto-track-janitor.js';

const log = pino({ name: 'weather-algo' });

const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKEND_READY_TIMEOUT_MS = 60_000;
const CONFIG_CHANGED_CHANNEL = 'config-changed';

async function main() {
  const ds = await initializeDataSource(createDataSource());
  await assertDatabaseExists(ds);

  const watchlistId = await seedWeatherAlgoWatchlistEntry(ds);
  log.info({ watchlistId }, 'weather-algo watchlist entry ready');

  const weatherConfigService = new WeatherConfigService(ds);
  const globalConfigService = new GlobalConfigService(ds);
  const { selectionService } = createWeatherSelectionServices(ds);
  const forecastService = new WeatherForecastService(ds);
  const positionForecastService = new WeatherPositionForecastService(ds);
  const autoTrackService = new WeatherAutoTrackService(ds);
  const marketService = new MarketService(ds);
  const reservationService = new ReservationService(ds);
  const simulationService = new SimulationService(ds);

  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();

  const registry = new WeatherStrategyRegistry();
  registry.register(new WeatherForecastStrategy());

  const connectionManager = new PolymarketConnectionManager({
    wsUrl: config.wsUrl,
    clobApi: config.clobApi,
  });

  const orderQueue = new RedisQueue<OrderSignal>(
    redisCmd,
    WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
    async () => {},
  );

  const closeQueue = new RedisQueue<OrderSignal>(
    redisCmd,
    WORKER_QUEUES.CLOSE_SIGNALS,
    async () => {},
  );

  try {
    await waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS);
  } catch (err) {
    log.warn({ err }, 'backend-ready signal not received within timeout — continuing anyway');
  }

  let weatherConfig = await weatherConfigService.getConfig();
  let globalConfig = await globalConfigService.getConfig();
  if (!weatherConfig.weatherAlgoEnabled) {
    log.warn('weather-algo is disabled in weather config — starting in standby mode');
  } else {
    log.info('weather-algo enabled in weather config');
  }

  const exitEvaluator = new WeatherExitEvaluator({
    ds,
    watchlistId,
    risk: weatherConfig,
    forecastService,
    positionForecastService,
    marketService,
    connectionManager,
    closeQueue,
  });

  const onSignal = async (signal: WeatherSignal): Promise<boolean> => {
    const result = await runWeatherEntryPipeline({
      signal,
      risk: weatherConfig,
      globalConfig,
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
      forecastService,
      positionForecastService,
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

  const runtimeStatus = new WeatherAlgoRuntimeStatusPublisher(redisCmd);
  const strategyRunner = new WeatherStrategyRunner({
    ds,
    selectionService,
    autoTrackService,
    forecastService,
    registry,
    redisCmd,
    onSignal,
    pollMs: config.pollMs,
    forecastCacheTtlMs: config.forecastCacheTtlMs,
    runtimeStatus,
    exitEvaluator,
  });
  strategyRunner.setRiskConfig(weatherConfig);
  const runAutoTrackTick = async (): Promise<void> => {
    try {
      const { added } = await runWeatherAutoTrackJanitorCycle(
        autoTrackService,
        selectionService,
      );
      if (added > 0) {
        await redisPub.publish(
          CONFIG_CHANGED_CHANNEL,
          JSON.stringify({ at: Date.now(), source: 'weather-algo-auto-track' }),
        );
      }
    } catch (err) {
      log.error({ err }, 'weather auto-track janitor failed');
    }
  };

  strategyRunner.start();

  const autoTrackTimer = safeInterval(
    () => runAutoTrackTick(),
    config.pollMs,
    'weather-algo:auto-track-janitor',
  );
  void runAutoTrackTick();

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

  redisSub.subscribe(CONFIG_CHANGED_CHANNEL, (err: Error | null | undefined) => {
    if (err) log.error({ err }, 'failed to subscribe to config-changed channel');
  });

  redisSub.on('message', (channel: string) => {
    if (channel !== CONFIG_CHANGED_CHANNEL) return;
    log.info('config-changed received — reloading weather config');
    void (async () => {
      try {
        WeatherConfigService.invalidateConfigCache();
        GlobalConfigService.invalidateConfigCache();
        weatherConfig = await weatherConfigService.getConfig();
        globalConfig = await globalConfigService.getConfig();
        log.info({ weatherAlgoEnabled: weatherConfig.weatherAlgoEnabled }, 'weather config reloaded');
        strategyRunner.setRiskConfig(weatherConfig);
        exitEvaluator.updateRiskConfig(weatherConfig);
      } catch (err) {
        log.error({ err }, 'failed to reload on config-changed');
      }
    })();
  });

  try {
    await connectionManager.getWsClient().connect();
    log.info('connected to Polymarket websocket');
  } catch (err) {
    log.warn({ err }, 'failed to connect to Polymarket websocket — continuing with REST polling');
  }

  log.info('Polywatch weather-algo started');

  const shutdown = async () => {
    log.info('shutting down...');
    strategyRunner.stop();
    clearInterval(heartbeatTimer);
    clearInterval(autoTrackTimer);
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
