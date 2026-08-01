import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import {
  collectDefaultMetrics,
  Registry,
} from 'prom-client';
import {
  assertDatabaseExists,
  createDataSource,
  initializeDataSource,
  seedDefaults,
} from '@polywatch/core';
import { createAppMetrics, setMetricsInstance, setRegistry } from './metrics.js';
import { config } from './config.js';
import { getRedis } from './redis.js';
import { requireServiceToken } from './middleware/auth.js';
import { initWebSocket } from './websocket.js';
import { createAuthRouter } from './routes/auth.js';
import { createWatchlistRouter } from './routes/watchlist.js';
import { createPositionsRouter } from './routes/positions.js';
import { createConfigRouter } from './routes/config.js';
import { createConfigPerKindRouter } from './routes/config-per-kind.js';
import { createSimulationRouter } from './routes/simulation.js';
import { createRealSessionsRouter } from './routes/real-sessions.js';
import { createInternalRouter } from './routes/internal.js';
import { createExecutionsRouter } from './routes/executions.js';
import { createMoveEventsRouter } from './routes/move-events.js';
import { createLeaderboardRouter } from './routes/leaderboard.js';
import { createTraderInsightRouter } from './routes/trader-insight.js';
import { createMarketTagsRouter } from './routes/market-tags.js';
import { createMarketIconsRouter } from './routes/market-icons.js';
import { createMarketsRouter } from './routes/markets.js';
import { createAlgoMarketsRouter } from './routes/algo-markets.js';
import { createAlgoAutoTrackRouter } from './routes/algo-auto-track.js';
import { createAlgoExecutionsRouter } from './routes/algo-executions.js';
import { createAlgoCapitalRouter } from './routes/algo-capital.js';
import { createWeatherAlgoCapitalRouter } from './routes/weather-algo-capital.js';
import { createAlgoMarketsPricesRouter } from './routes/algo-markets-prices.js';
import { createAlgoSurveillanceHistoryRouter } from './routes/algo-surveillance-history.js';
import { createAlgoEventsRouter } from './routes/algo-events.js';
import { createAlgoMarketChartRouter } from './routes/algo-market-chart.js';
import { createAlgoOptimizeReportRouter } from './routes/algo-optimize-report.js';
import { createAlgoWorkerQueueStatusRouter } from './routes/algo-worker-queue-status.js';
import { createReportsRouter } from './routes/reports.js';
import { createMarketChartRouter } from './routes/market-chart.js';
import { createWalletRouter } from './routes/wallet.js';
import { createE2eRunsRouter } from './routes/e2e-runs.js';
import { createMarketSyncConfigRouter } from './routes/market-sync-config.js';
import { createSystemConfigRouter } from './routes/system-config.js';
import { createSystemOverviewRouter } from './routes/system-overview.js';
import { createSystemAuditRouter } from './routes/system-audit.js';
import { createCryptoAlgoMonitorRouter } from './routes/crypto-algo-monitor.js';
import { createWeatherAlgoMarketsRouter } from './routes/weather-algo-markets.js';
import { createWeatherAlgoDiscoverRouter } from './routes/weather-algo-discover.js';
import { createWeatherAlgoForecastsRouter } from './routes/weather-algo-forecasts.js';
import { createWeatherAlgoAutoTrackRouter } from './routes/weather-algo-auto-track.js';
import { killAllAuditProcesses } from './services/system-audit-runner.js';
import { killAllCryptoAlgoMonitorProcesses } from './services/crypto-algo-monitor.service.js';

import { initBackendConfigService } from './system-config-resolver.js';
import { bootstrapWalletAccounts } from './polymarket/wallet-accounts.js';
import { startSimAutoSnapshotLoop, stopSimAutoSnapshotLoop } from './simulation/auto-snapshot-loop.js';
import {
  startRealAutoSnapshotLoop,
  stopRealAutoSnapshotLoop,
} from './simulation/real-auto-snapshot-loop.js';
import {
  createE2eRunnerService,
  ensureE2eLogDir,
} from './services/e2e-runner.service.js';
import pino from 'pino';

const log = pino({ name: 'backend' });

async function main() {
  log.info('boot phase: initializing database');
  const ds = await initializeDataSource(createDataSource());
  log.info('boot phase: database initialized');

  log.info('boot phase: asserting database exists');
  await assertDatabaseExists(ds);

  log.info('boot phase: seeding defaults');
  await seedDefaults(ds);

  initBackendConfigService(ds);

  log.info('boot phase: bootstrapping wallet accounts');
  await bootstrapWalletAccounts(ds);

  ensureE2eLogDir();
  const e2eRunner = createE2eRunnerService(ds);

  log.info('boot phase: recovering stale e2e runs');
  await e2eRunner.recoverStaleRuns();

  const app = express();
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // Register custom application metrics
  const metrics = createAppMetrics(registry);
  setMetricsInstance(metrics);
  setRegistry(registry);

  // Restrict cross-origin browser access to the configured frontend origins.
  // Same-origin requests (Vite proxy, nginx) and non-browser clients
  // (worker, curl) are unaffected — they send no Origin header.
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  app.use(
    pinoHttp({
      // Never log credentials carried by headers.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-service-token"]',
          'req.headers.cookie',
        ],
        censor: '[redacted]',
      },
    }),
  );

  const jwtLimiter = rateLimit({
    windowMs: 60_000,
    max: 1_000,
    standardHeaders: true,
    legacyHeaders: false,
    // Worker callbacks (x-service-token) must not share the UI quota.
    skip: (req) => req.headers['x-service-token'] === config.serviceToken,
  });

  app.get('/health', async (_req, res) => {
    try {
      await ds.query('SELECT 1');
      res.json({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Metrics expose internal topology — require the inter-service token
  // (configure it as a scrape header in Prometheus).
  app.get('/metrics', requireServiceToken, async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.use('/api/auth', jwtLimiter, createAuthRouter(ds));
  app.use('/api/watchlist', jwtLimiter, createWatchlistRouter(ds));
  app.use('/api/leaderboard', jwtLimiter, createLeaderboardRouter());
  app.use('/api/traders', jwtLimiter, createTraderInsightRouter(ds));
  app.use('/api/market-tags', jwtLimiter, createMarketTagsRouter());
  app.use('/market-icons', createMarketIconsRouter(ds));
  app.use('/api/markets', jwtLimiter, createMarketsRouter(ds));
  app.use('/api/algo-markets', jwtLimiter, createAlgoMarketsRouter(ds));
  app.use('/api/algo-auto-track', jwtLimiter, createAlgoAutoTrackRouter(ds));
  app.use('/api/algo/executions', jwtLimiter, createAlgoExecutionsRouter(ds));
  app.use('/api/algo/capital', jwtLimiter, createAlgoCapitalRouter(ds));
  app.use('/api/algo/markets-prices', jwtLimiter, createAlgoMarketsPricesRouter(ds));
  app.use('/api/algo/surveillance-history', jwtLimiter, createAlgoSurveillanceHistoryRouter(ds));
  app.use('/api/algo/market-chart', jwtLimiter, createAlgoMarketChartRouter(ds));
  app.use('/api/market-chart', jwtLimiter, createMarketChartRouter(ds));
  app.use('/api/algo/events', jwtLimiter, createAlgoEventsRouter(ds));
  app.use('/api/algo', jwtLimiter, createAlgoWorkerQueueStatusRouter());
  app.use('/api/algo', jwtLimiter, createAlgoOptimizeReportRouter(ds));
  app.use('/api/reports', jwtLimiter, createReportsRouter(ds));
  app.use('/api/copied-positions', jwtLimiter, createPositionsRouter(ds));
  app.use('/api', jwtLimiter, createConfigRouter(ds));
  app.use('/api', jwtLimiter, createConfigPerKindRouter(ds));
  app.use('/api', jwtLimiter, createSimulationRouter(ds));
  app.use('/api', jwtLimiter, createRealSessionsRouter(ds));
  app.use('/api/executions', jwtLimiter, createExecutionsRouter(ds));
  app.use('/api/move-events', jwtLimiter, createMoveEventsRouter(ds));
  app.use('/api/wallet', jwtLimiter, createWalletRouter(ds));
  app.use('/api/e2e-runs', jwtLimiter, createE2eRunsRouter(e2eRunner));
  app.use('/api', jwtLimiter, createMarketSyncConfigRouter(ds));
  app.use('/api/system-config', jwtLimiter, createSystemConfigRouter(ds));
  app.use('/api/system', jwtLimiter, createSystemOverviewRouter(ds));
  app.use('/api/system', jwtLimiter, createSystemAuditRouter());
  app.use('/api/system/crypto-algo-monitor', jwtLimiter, createCryptoAlgoMonitorRouter());
  app.use('/api/weather-algo-markets', jwtLimiter, createWeatherAlgoMarketsRouter(ds));
  app.use('/api/weather-algo-discover', jwtLimiter, createWeatherAlgoDiscoverRouter(ds));
  app.use('/api/weather-algo-forecasts', jwtLimiter, createWeatherAlgoForecastsRouter(ds));
  app.use('/api/weather-algo-auto-track', jwtLimiter, createWeatherAlgoAutoTrackRouter(ds));
  app.use('/api/weather-algo/capital', jwtLimiter, createWeatherAlgoCapitalRouter(ds));
  app.use('/api/internal', createInternalRouter(ds));

  const server = createServer(app);
  initWebSocket(server);

  // Singleton loop: interval enforced via the DB clock, guarded against
  // hot-reload/multi-process duplicates (see auto-snapshot-loop.ts).
  startSimAutoSnapshotLoop(ds);
  startRealAutoSnapshotLoop(ds);

  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down');
    killAllAuditProcesses();
    killAllCryptoAlgoMonitorProcesses();
    stopSimAutoSnapshotLoop();
    stopRealAutoSnapshotLoop();
    void e2eRunner
      .shutdown()
      .catch((err) => log.warn({ err }, 'e2e runner shutdown failed'))
      .finally(() => {
        server.close(() => {
          void ds.destroy()
            .catch((err) => log.warn({ err }, 'ds.destroy failed during shutdown'))
            .finally(() => process.exit(0));
        });
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(
        { port: config.port, err },
        'port already in use — stop the existing backend or set PORT to another value',
      );
      process.exit(1);
    }
    log.error({ err }, 'server listen failed');
    process.exit(1);
  });

  log.info({ port: config.port }, 'boot phase: listening');
  server.listen(config.port, () => {
    log.info({ port: config.port }, 'backend listening');

    // Notify worker(s) that the backend is ready to serve internal API calls.
    // This avoids ECONNREFUSED races when the worker starts in parallel.
    const readyPayload = JSON.stringify({
      ready: true,
      at: Date.now(),
      pid: process.pid,
    });
    getRedis()
      .publish('backend-ready', readyPayload)
      .then(() => {
        getRedis()
          .set('backend-ready', readyPayload, 'EX', 60)
          .catch((err) => log.warn({ err }, 'failed to set backend-ready key'));
      })
      .catch((err) => {
        log.warn({ err }, 'failed to publish backend-ready');
      });
  });
}

main().catch((err) => {
  log.error({ err }, 'backend startup failed');
  process.exit(1);
});
