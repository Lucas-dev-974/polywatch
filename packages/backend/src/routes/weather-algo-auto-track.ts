import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { WeatherAutoTrackService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

const createRuleSchema = z.object({
  city: z.string().min(1),
  lookAheadDays: z.number().int().min(1).max(30).optional(),
  /** @deprecated Ignored — city-first always uses highest_temp. */
  metric: z.enum(['highest_temp', 'lowest_temp']).optional(),
  /** @deprecated Ignored — city-first always uses city_follow. */
  mode: z.enum(['city_follow']).optional(),
});

const patchRuleSchema = z.object({
  enabled: z.boolean(),
});

export function createWeatherAlgoAutoTrackRouter(ds: DataSource): Router {
  const router = Router();
  const autoTrackService = new WeatherAutoTrackService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    res.json(await autoTrackService.loadAll());
  });

  router.post('/', requireJwt, async (req, res) => {
    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const { city, lookAheadDays } = parsed.data;
    const rule = await autoTrackService.addRule(
      city,
      'highest_temp',
      lookAheadDays ?? 1,
      'city_follow',
    );
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(201).json(rule);
  });

  router.delete('/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'id must be a number' });
      return;
    }
    await autoTrackService.removeRule(id);
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(204).end();
  });

  router.patch('/:id', requireJwt, async (req, res) => {
    const parsed = patchRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'id must be a number' });
      return;
    }
    await autoTrackService.setEnabled(id, parsed.data.enabled);
    await publishConfigChanged();
    emitAlgoMarketsChanged();
    res.status(200).json({ ok: true });
  });

  return router;
}
