import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { requireServiceToken } from '../middleware/auth.js';
import { createInternalWatchlistRouter } from './internal/watchlist-routes.js';
import { createInternalPositionsRouter } from './internal/positions-routes.js';
import { createInternalQueueRouter } from './internal/queue-routes.js';
import { createInternalClobOpsRouter } from './internal/clob-ops-routes.js';
import { createInternalMetricsRouter } from './internal/metrics-routes.js';
import { emitAlert } from '../websocket.js';

export function createInternalRouter(ds: DataSource): Router {
  const router = Router();
  router.use(requireServiceToken);

  router.use(createInternalWatchlistRouter(ds));
  router.use(createInternalPositionsRouter(ds));
  router.use(createInternalQueueRouter());
  router.use(createInternalClobOpsRouter(ds));
  router.use('/metrics', createInternalMetricsRouter());

  // Kill-switch alert endpoint — called by the worker when block_and_notify fires.
  router.post('/kill-switch-alert', (req, res) => {
    emitAlert(req.body);
    res.json({ ok: true });
  });

  return router;
}
