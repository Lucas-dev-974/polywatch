import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { MarketSyncConfigService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';

const updateSchema = z
  .object({
    maxMarketsPerCycle: z.number().int().min(1).max(100),
    defaultFidelityMinutes: z.number().int().min(1).max(1440),
    expirationFidelityMinutes: z.number().int().min(1).max(1440),
    hourlySyncIntervalMs: z.number().int().min(60_000).max(86_400_000),
    expirationIntervalMs: z.number().int().min(5_000).max(3_600_000),
    tickRetentionDays: z.number().int().min(0).max(365),
  })
  .partial()
  .strict();

export function createMarketSyncConfigRouter(ds: DataSource): Router {
  const router = Router();
  const service = new MarketSyncConfigService(ds);

  router.get('/market-sync-config', requireJwt, async (_req, res) => {
    res.json(await service.getConfig());
  });

  router.put('/market-sync-config', requireJwt, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const updated = await service.updateConfig(parsed.data);
    await publishConfigChanged();
    res.json(updated);
  });

  return router;
}
