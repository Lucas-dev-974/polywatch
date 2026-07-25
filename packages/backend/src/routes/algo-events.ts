import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { AlgoEventsService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

const querySchema = {
  limit: { type: 'number', coerce: true, min: 1, max: 200, default: 50 },
  offset: { type: 'number', coerce: true, min: 0, default: 0 },
} as const;

export function createAlgoEventsRouter(ds: DataSource): Router {
  const router = Router();
  const algoEventsService = new AlgoEventsService(ds);

  router.get('/', requireJwt, async (req, res) => {
    const limit = Math.min(
      Math.max(1, Number(req.query.limit ?? querySchema.limit.default)),
      querySchema.limit.max,
    );
    const offset = Math.max(
      0,
      Number(req.query.offset ?? querySchema.offset.default),
    );

    const result = await algoEventsService.loadRecent({ limit, offset });
    res.json(result);
  });

  return router;
}
