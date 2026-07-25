import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { SystemConfigService } from '@polywatch/core/services/system-config.service';
import { SYSTEM_CONFIG_DEFAULTS } from '@polywatch/core/seed/system-config-defaults';
import { requireJwt } from '../middleware/auth.js';

const systemConfigUpdateSchema = z.object({
  value: z.string(),
}).strict();

export function createSystemConfigRouter(ds: DataSource): Router {
  const router = Router();
  const service = new SystemConfigService(ds);

  // GET /api/system-config/by-category/:category — filter by category
  router.get('/by-category/:category', requireJwt, async (req, res) => {
    const category = req.params.category as string;
    const entries = await service.getByCategory(category);
    res.json(entries);
  });

  // GET /api/system-config — list all keys
  router.get('/', requireJwt, async (_req, res) => {
    const all = await service.getAll();
    res.json(all);
  });

  // GET /api/system-config/:key — get single key
  router.get('/:key', requireJwt, async (req, res) => {
    const key = req.params.key as string;
    const value = await service.get(key);
    if (value === null) {
      res.status(404).json({ error: 'not_found', key });
      return;
    }
    res.json({ key, value });
  });

  // PUT /api/system-config/:key — update a key
  router.put('/:key', requireJwt, async (req, res) => {
    const key = req.params.key as string;
    const parsed = systemConfigUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    await service.set(key, parsed.data.value);
    res.json({ key, value: parsed.data.value });
  });

  // POST /api/system-config/seed — re-seed defaults (inserts missing keys only)
  router.post('/seed', requireJwt, async (_req, res) => {
    await service.seedDefaults(SYSTEM_CONFIG_DEFAULTS);
    res.json({ ok: true });
  });

  return router;
}
