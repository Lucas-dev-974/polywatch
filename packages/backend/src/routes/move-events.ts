import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { MoveEventService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

const querySchema = z.object({
  processed: z.enum(['true', 'false']).optional(),
  mode: z.enum(['sim', 'real']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function createMoveEventsRouter(ds: DataSource): Router {
  const router = Router();
  const moveEventService = new MoveEventService(ds);

  router.get('/', requireJwt, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    const { processed, mode, limit, offset } = parsed.data;
    const { items, total } = await moveEventService.loadRecent({
      limit,
      offset,
      mode,
      processed:
        processed === 'true' ? true : processed === 'false' ? false : undefined,
    });

    res.json({ items, total });
  });

  router.delete('/', requireJwt, async (_req, res) => {
    const deleted = await moveEventService.deleteAll();
    res.json({ deleted });
  });

  return router;
}
