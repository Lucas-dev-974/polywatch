import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { loadCryptoAlgoOptimizeReport } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { recordApiRouteDuration } from '../metrics.js';
import { parseOptionalDate } from './lib/query-params.js';

export function createAlgoOptimizeReportRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/optimize-report', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const closedFrom = parseOptionalDate(req.query.closedFrom);
      const closedTo = parseOptionalDate(req.query.closedTo);
      const { report, configFingerprint } = await loadCryptoAlgoOptimizeReport(ds, {
        closedFrom,
        closedTo,
      });
      res.json({ ...report, configFingerprint });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'optimize_report_failed',
      });
    } finally {
      recordApiRouteDuration(
        'GET /api/algo/optimize-report',
        performance.now() - start,
      );
    }
  });

  return router;
}
