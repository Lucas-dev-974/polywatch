import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { AlgoSurveillanceService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createAlgoSurveillanceHistoryRouter(ds: DataSource): Router {
  const router = Router();
  const service = new AlgoSurveillanceService(ds);

  router.get('/', requireJwt, async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50), 200));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    res.json(await service.listHistory(limit, offset));
  });

  return router;
}
