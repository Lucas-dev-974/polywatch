import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  WatchlistService,
  CopyConfigService,
  MIN_MOVE_DETECTOR_INTERVAL_MS,
  MAX_MOVE_DETECTOR_INTERVAL_MS,
} from '@polywatch/core';
import type { AuthRequest } from '../middleware/auth.js';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';
import { ethAddressSchema } from '../validation/eth-address.js';

const createSchema = z.object({
  traderAddress: ethAddressSchema,
  nickname: z.string().max(64).optional(),
  simEnabled: z.boolean().optional(),
  realEnabled: z.boolean().optional(),
});

// PATCH whitelist: traderAddress is immutable; only flags/nickname may change.
const updateSchema = z
  .object({
    nickname: z.string().max(64).nullable(),
    active: z.boolean(),
    simEnabled: z.boolean(),
    realEnabled: z.boolean(),
  })
  .partial()
  .strict();

const detectorSettingsSchema = z.object({
  moveDetectorIntervalMs: z
    .number()
    .int()
    .min(MIN_MOVE_DETECTOR_INTERVAL_MS)
    .max(MAX_MOVE_DETECTOR_INTERVAL_MS),
});

export function createWatchlistRouter(ds: DataSource): Router {
  const router = Router();
  const service = new WatchlistService(ds);
  const copyConfigService = new CopyConfigService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    res.json(await service.loadAll());
  });

  router.get('/settings', requireJwt, async (_req, res) => {
    const config = await copyConfigService.getConfig();
    res.json({ moveDetectorIntervalMs: config.moveDetectorIntervalMs });
  });

  router.put('/settings', requireJwt, async (req, res) => {
    const parsed = detectorSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const updated = await copyConfigService.updateConfig(parsed.data);
    await publishConfigChanged('copy');
    res.json({ moveDetectorIntervalMs: updated.moveDetectorIntervalMs });
  });

  router.post('/', requireJwt, async (req: AuthRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    try {
      const entry = await service.create(parsed.data);
      await publishConfigChanged();
      res.status(201).json(entry);
    } catch (e) {
      if ((e as Error).message === 'max_watchlist_size') {
        res.status(409).json({ error: 'max_watchlist_size' });
        return;
      }
      throw e;
    }
  });

  router.patch('/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    try {
      const entry = await service.update(id, parsed.data);
      await publishConfigChanged();
      res.json(entry);
    } catch (e) {
      if ((e as Error).message === 'not_found') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      throw e;
    }
  });

  router.delete('/:id', requireJwt, async (req, res) => {
    await service.delete(Number(req.params.id));
    await publishConfigChanged();
    res.status(204).end();
  });

  return router;
}
