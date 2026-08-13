import { Router } from 'express';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { getRedis } from '../redis.js';

const log = pino({ name: 'weather-algo:routes' });

interface WeatherRuntimeStatus {
  evaluableSelections?: number;
  lastEvaluatedAt?: number | null;
  lastSkipReason?: string | null;
  lastSkipAt?: number | null;
}

export function createWeatherAlgoMarketsRouter(ds: DataSource): Router {
  const router = Router();
  const autoTrackService = new WeatherAutoTrackService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    // Legacy selection list — return empty array (city-first mode only).
    res.json([]);
  });

  router.get('/status', requireJwt, async (_req, res) => {
    let heartbeatValue: string | null = null;
    let runtimeRaw: string | null = null;
    let watchedCities = 0;

    try {
      const redis = getRedis();
      const [hb, rt, rules] = await Promise.all([
        redis.get('weather-algo:heartbeat'),
        redis.get('weather-algo:runtime-status'),
        autoTrackService.loadAllEnabled(),
      ]);
      heartbeatValue = hb;
      runtimeRaw = rt;
      watchedCities = rules.length;
    } catch (err) {
      log.warn({ err }, 'status endpoint degraded');
      watchedCities = (await autoTrackService.loadAllEnabled().catch(() => [])).length;
    }

    let alive = false;
    let lastSeenAt: Date | null = null;
    if (heartbeatValue) {
      const ts = Number(heartbeatValue);
      if (Number.isFinite(ts)) {
        lastSeenAt = new Date(ts);
        alive = Date.now() - ts <= 60_000;
      }
    }

    let runtime: WeatherRuntimeStatus | null = null;
    if (runtimeRaw) {
      try {
        runtime = JSON.parse(runtimeRaw) as WeatherRuntimeStatus;
      } catch {
        runtime = null;
      }
    }

    res.json({
      alive,
      lastSeenAt,
      enabledSelections: 0,
      selectionsWithMarket: 0,
      watchedCities,
      evaluableSelections: runtime?.evaluableSelections ?? watchedCities,
      lastEvaluatedAt: runtime?.lastEvaluatedAt
        ? new Date(runtime.lastEvaluatedAt)
        : null,
      lastSkipReason: runtime?.lastSkipReason ?? null,
      lastSkipAt: runtime?.lastSkipAt ? new Date(runtime.lastSkipAt) : null,
    });
  });

  return router;
}
