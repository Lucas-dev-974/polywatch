import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  CryptoAlgoDataService,
  CRYPTO_ALGO_DATA_TABLE_IDS,
  type CryptoAlgoDataTableId,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { parseLimit, parseOffset, parseOptionalDate } from './lib/query-params.js';

function isValidTableId(value: string): value is CryptoAlgoDataTableId {
  return (CRYPTO_ALGO_DATA_TABLE_IDS as readonly string[]).includes(value);
}

export function createCryptoAlgoDataRouter(ds: DataSource): Router {
  const router = Router();
  const service = new CryptoAlgoDataService(ds);

  router.get('/tables', requireJwt, async (_req, res) => {
    res.json(await service.getTablesSummary());
  });

  router.get('/coverage', requireJwt, async (_req, res) => {
    res.json(await service.getCoverage());
  });

  router.get('/price-ticks', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(await service.listPriceTicks({ conditionId, from, to, limit, offset }));
  });

  router.get('/surveillance-snapshots', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    res.json(await service.listSurveillanceSnapshots({ limit, offset }));
  });

  router.get('/post-entry-mid-samples', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(
      await service.listPostEntryMidSamples({ conditionId, from, to, limit, offset }),
    );
  });

  router.get('/market-selections', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const enabled =
      req.query.enabled === 'true' || req.query.enabled === '1'
        ? true
        : req.query.enabled === 'false' || req.query.enabled === '0'
          ? false
          : undefined;
    res.json(await service.listMarketSelections({ enabled, limit, offset }));
  });

  router.get('/auto-track-rules', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const enabled =
      req.query.enabled === 'true' || req.query.enabled === '1'
        ? true
        : req.query.enabled === 'false' || req.query.enabled === '0'
          ? false
          : undefined;
    res.json(await service.listAutoTrackRules({ enabled, limit, offset }));
  });

  router.get('/executions', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(
      await service.listExecutions({ conditionId, mode, status, from, to, limit, offset }),
    );
  });

  router.get('/positions', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(
      await service.listPositions({ conditionId, mode, status, from, to, limit, offset }),
    );
  });

  router.delete('/tables', requireJwt, async (_req, res) => {
    res.json(await service.deleteAllRecordedData());
  });

  router.delete('/tables/:id', requireJwt, async (req, res) => {
    const id = req.params.id as string;
    if (!isValidTableId(id)) {
      res.status(400).json({ error: `Unknown table id: ${id}` });
      return;
    }
    try {
      res.json(await service.deleteTableData(id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (message === 'read_only_table') {
        res.status(403).json({ error: 'read_only_table' });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  return router;
}
