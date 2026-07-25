import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  createAlgoSelectionServices,
  CRYPTO_ALGO_RUNTIME_STATUS_KEY,
  parseCryptoAlgoRuntimeStatus,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged, getRedis } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

const createSelectionSchema = z.object({
  conditionId: z.string().min(1),
  question: z.string().optional(),
  cryptoSymbol: z.string().optional(),
  interval: z.string().optional(),
  slug: z.string().optional(),
});

const patchSelectionSchema = z.object({
  enabled: z.boolean(),
});

export function createAlgoMarketsRouter(ds: DataSource): Router {
  const router = Router();
  const { selectionService: service } = createAlgoSelectionServices(ds);

  router.get('/', requireJwt, async (_req, res) => {
    res.json(await service.loadAll());
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
    const selection = await service.addSelection(conditionId, meta);
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

  router.get('/status', requireJwt, async (_req, res) => {
    const redis = getRedis();
    const [heartbeatValue, runtimeRaw, counts] = await Promise.all([
      redis.get('crypto-algo:heartbeat'),
      redis.get(CRYPTO_ALGO_RUNTIME_STATUS_KEY),
      service.getStatusCounts(),
    ]);

    let alive = false;
    let lastSeenAt: Date | null = null;
    if (heartbeatValue) {
      const ts = Number(heartbeatValue);
      if (Number.isFinite(ts)) {
        lastSeenAt = new Date(ts);
        alive = Date.now() - ts <= 60_000;
      }
    }

    const runtime = parseCryptoAlgoRuntimeStatus(runtimeRaw);

    res.json({
      alive,
      lastSeenAt,
      enabledSelections: counts.enabledSelections,
      selectionsWithMarket: counts.selectionsWithMarket,
      evaluableSelections: runtime?.evaluableSelections ?? counts.evaluableSelections,
      wsConnected: runtime?.wsConnected ?? null,
      lastEvaluatedAt: runtime?.lastEvaluatedAt ? new Date(runtime.lastEvaluatedAt) : null,
      lastSkipReason: runtime?.lastSkipReason ?? null,
      lastSkipAt: runtime?.lastSkipAt ? new Date(runtime.lastSkipAt) : null,
    });
  });

  /**
   * Internal endpoint for crypto-algo worker to notify of market changes.
   * Called when auto-track discovers new markets.
   */
  router.post('/notify-changed', async (req, res) => {
    // Simple endpoint without auth - only called by trusted crypto-algo worker
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  return router;
}