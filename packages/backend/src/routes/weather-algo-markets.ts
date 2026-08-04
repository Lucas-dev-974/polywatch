import { Router } from 'express';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackService } from '@polywatch/core';
import { requireJwt, requireServiceToken } from '../middleware/auth.js';
import { publishConfigChanged, getRedis } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

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

  router.post('/notify-changed', requireServiceToken, async (_req, res) => {
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  /** Per-market selection is deprecated — use /weather-algo-auto-track (city watch). */
  router.post('/', requireJwt, async (_req, res) => {
    res.status(410).json({
      error: 'deprecated',
      message:
        'La sélection par sous-marché est retirée. Surveillez une ville via POST /weather-algo-auto-track.',
    });
  });

  router.delete('/:conditionId', requireJwt, async (_req, res) => {
    // Legacy per-market selection removal — no-op in city-first mode.
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(204).end();
  });

  router.patch('/:conditionId', requireJwt, async (_req, res) => {
    // Legacy per-market selection toggle — no-op in city-first mode.
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  return router;
}
