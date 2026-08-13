import pino from 'pino';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  WeatherConfigService,
  GlobalConfigService,
  WeatherAutoTrackService,
  WeatherForecastService,
  WeatherPositionForecastService,
  WeatherForecastHistoryRecorder,
  WeatherMarketSnapshotRecorder,
  WeatherEvaluationRecorder,
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
  createBackendClient,
} from '@polywatch/core';
import { config } from './config.js';
import { seedWeatherAlgoWatchlistEntry } from './watchlist-seed.js';
import {
  WeatherStrategyRegistry,
  WeatherForecastStrategy,
  WeatherForecastAlignedStrategy,
  type WeatherSignal,
} from './strategy/registry.js';
import { WeatherStrategyRunner } from './strategy/strategy-runner.js';
import { WeatherAlgoRuntimeStatusPublisher } from './runtime-status.js';
import { runWeatherEntryPipeline } from './processors/weather-entry-pipeline.js';
import { WeatherExitEvaluator } from './processors/weather-exit-evaluator.js';
import { WeatherAlgoMetricsPublisher } from './metrics-publisher.js';

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
  const forecastService = new WeatherForecastService(ds);
  const positionForecastService = new WeatherPositionForecastService(ds);
  const forecastHistoryRecorder = new WeatherForecastHistoryRecorder(ds);
  const marketSnapshotRecorder = new WeatherMarketSnapshotRecorder(ds);
  const evaluationRecorder = new WeatherEvaluationRecorder(ds);
  const autoTrackService = new WeatherAutoTrackService(ds);
  const marketService = new MarketService(ds);
  const reservationService = new ReservationService(ds);
  const simulationService = new SimulationService(ds);

  const redisCmd = createRedis();
  const redisPub = createRedis();
  const redisSub = createRedis();

  const registry = new WeatherStrategyRegistry();
  registry.register(new WeatherForecastStrategy());
  registry.register(new WeatherForecastAlignedStrategy());

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
    redisCmd,
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
  const backendClient = createBackendClient({
    backendUrl: config.backendUrl,
    serviceToken: config.serviceToken,
  });
  const metricsPublisher = new WeatherAlgoMetricsPublisher(backendClient);
  const strategyRunner = new WeatherStrategyRunner({
    ds,
    autoTrackService,
    forecastService,
    registry,
    redisCmd,
    onSignal,
    pollMs: config.pollMs,
    forecastCacheTtlMs: config.forecastCacheTtlMs,
    runtimeStatus,
    exitEvaluator,
    onParseResult: (parsed) => metricsPublisher.recordParse(parsed),
    forecastHistoryRecorder,
    marketSnapshotRecorder,
    evaluationRecorder,
  });
  strategyRunner.setRiskConfig(weatherConfig);

  strategyRunner.start();
  metricsPublisher.start();

  const dataPurgeTimer = safeInterval(
    async () => {
      const cfg = await weatherConfigService.getConfig();
      try {
        const fhMs = cfg.weatherAlgoForecastHistoryRetentionDays * 86_400_000;
        const snapMs = cfg.weatherAlgoMarketSnapshotRetentionDays * 86_400_000;
        const evalMs = cfg.weatherAlgoEvaluationLogRetentionDays * 86_400_000;
        const fhDeleted = await forecastHistoryRecorder.purgeOlderThan(fhMs);
        if (fhDeleted > 0) log.info({ deleted: fhDeleted }, 'purged weather_forecast_history');
        const snapDeleted = await marketSnapshotRecorder.purgeOlderThan(snapMs);
        if (snapDeleted > 0) {
          log.info({ deleted: snapDeleted }, 'purged weather_market_snapshots (cascade bucket_ticks)');
        }
        const evalDeleted = await evaluationRecorder.purgeOlderThan(evalMs);
        if (evalDeleted > 0) log.info({ deleted: evalDeleted }, 'purged weather_evaluation_log');
      } catch (err) {
        log.error({ err }, 'weather data purge failed');
      }
    },
    60 * 60 * 1000,
    'weather-algo:data-purge',
  );

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

  redisSub.on('message', (channel: string, message: string) => {
    if (channel !== CONFIG_CHANGED_CHANNEL) return;

    let kind: string | undefined;
    try {
      const parsed = JSON.parse(message) as { kind?: unknown };
      kind = typeof parsed.kind === 'string' ? parsed.kind : undefined;
    } catch {
      kind = undefined;
    }

    // Ignore copy/crypto-only updates — avoid weather eval fan-out.
    if (kind === 'copy' || kind === 'crypto') {
      log.debug({ kind }, 'config-changed ignored for weather-algo');
      return;
    }

    log.info({ kind: kind ?? 'unspecified' }, 'config-changed received — reloading weather config');
    void (async () => {
      try {
        WeatherConfigService.invalidateConfigCache();
        GlobalConfigService.invalidateConfigCache();
        weatherConfig = await weatherConfigService.getConfig();
        globalConfig = await globalConfigService.getConfig();
        log.info({ weatherAlgoEnabled: weatherConfig.weatherAlgoEnabled }, 'weather config reloaded');
        strategyRunner.setRiskConfig(weatherConfig);
        exitEvaluator.updateRiskConfig(weatherConfig);
        strategyRunner.requestEvaluationCycle();
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
    metricsPublisher.stop();
    clearInterval(heartbeatTimer);
    clearInterval(dataPurgeTimer);
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
