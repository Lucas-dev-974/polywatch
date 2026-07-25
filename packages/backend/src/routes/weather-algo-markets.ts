import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { createWeatherSelectionServices } from '@polywatch/core';
import { requireJwt, requireServiceToken } from '../middleware/auth.js';
import { publishConfigChanged, getRedis } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

const log = pino({ name: 'weather-algo:routes' });

const createSelectionSchema = z.object({
  conditionId: z.string().min(1),
  question: z.string().optional(),
  eventSlug: z.string().optional(),
  city: z.string().optional(),
  targetDate: z.string().optional(),
  metric: z.string().optional(),
  targetValue: z.number().optional(),
});

const patchSelectionSchema = z.object({
  enabled: z.boolean(),
});

interface WeatherRuntimeStatus {
  evaluableSelections?: number;
  lastEvaluatedAt?: number | null;
  lastSkipReason?: string | null;
  lastSkipAt?: number | null;
}

export function createWeatherAlgoMarketsRouter(ds: DataSource): Router {
  const router = Router();
  const { selectionService: service } = createWeatherSelectionServices(ds);

  // Static routes must be registered BEFORE parameterized routes to avoid
  // Express matching `/:conditionId` for paths like `/status` or `/notify-changed`.
  router.get('/', requireJwt, async (_req, res) => {
    res.json(await service.loadAll());
  });

  router.get('/status', requireJwt, async (_req, res) => {
    let heartbeatValue: string | null = null;
    let runtimeRaw: string | null = null;
    let counts: { enabledSelections: number; selectionsWithMarket: number };

    try {
      const redis = getRedis();
      [heartbeatValue, runtimeRaw, counts] = await Promise.all([
        redis.get('weather-algo:heartbeat'),
        redis.get('weather-algo:runtime-status'),
        service.getStatusCounts(),
      ]);
    } catch (err) {
      log.warn({ err }, 'status endpoint degraded — using DB counts only');
      counts = await service.getStatusCounts().catch(() => ({
        enabledSelections: 0,
        selectionsWithMarket: 0,
      }));
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
      enabledSelections: counts.enabledSelections,
      selectionsWithMarket: counts.selectionsWithMarket,
      evaluableSelections:
        runtime?.evaluableSelections ?? counts.enabledSelections,
      lastEvaluatedAt: runtime?.lastEvaluatedAt
        ? new Date(runtime.lastEvaluatedAt)
        : null,
      lastSkipReason: runtime?.lastSkipReason ?? null,
      lastSkipAt: runtime?.lastSkipAt ? new Date(runtime.lastSkipAt) : null,
    });
  });

  /**
   * Internal endpoint for weather-algo worker to notify of market changes.
   * Protected by the inter-service token.
   */
  router.post('/notify-changed', requireServiceToken, async (_req, res) => {
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  router.post('/', requireJwt, async (req, res) => {
    const parsed = createSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const { conditionId, ...meta } = parsed.data;
    const normalizedMeta = {
      ...meta,
      targetDate: meta.targetDate ? new Date(meta.targetDate) : null,
    };
    const selection = await service.addSelection(conditionId, normalizedMeta);
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(201).json(selection);
  });

  router.delete('/:conditionId', requireJwt, async (req, res) => {
    const conditionId = String(req.params.conditionId);
    await service.removeSelection(conditionId);
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(204).end();
  });

  router.patch('/:conditionId', requireJwt, async (req, res) => {
    const parsed = patchSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const conditionId = String(req.params.conditionId);
    await service.setEnabled(conditionId, parsed.data.enabled);
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  return router;
}
