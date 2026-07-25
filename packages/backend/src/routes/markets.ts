import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { fetchGammaMarketsByTagSlug, fetchGammaMarketsKeyset, isMarketActive, MarketPositionTickService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { resolveMarketMetrics } from '../polymarket/market-metrics.js';
import { CONDITION_ID_PATTERN } from '../lib/condition-id.js';

const conditionIdSchema = z.string().regex(CONDITION_ID_PATTERN);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  afterCursor: z.string().min(1).optional(),
  order: z.string().min(1).max(100).default('volume24hr'),
  ascending: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  tagSlug: z.string().min(1).max(100).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v !== undefined ? v === 'true' : undefined)),
});

const metricsQuerySchema = z.object({
  assetId: z.string().min(1).optional(),
  includeHistory: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cryptoSymbol: z.string().min(1).optional(),
  interval: z.string().min(1).optional(),
});

export function createMarketsRouter(ds: DataSource): Router {
  const router = Router();

  const parseDateParam = (value: unknown): Date | undefined | 'invalid' => {
    if (value === undefined || value === '') return undefined;
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : 'invalid';
  };

  router.get('/', requireJwt, async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    const { limit, afterCursor, order, ascending, tagSlug, active } = parsed.data;

    try {
      const result = tagSlug
        ? await fetchGammaMarketsByTagSlug({
            tagSlug,
            limit,
            offset: afterCursor ? Number(afterCursor) : 0,
            order,
            ascending,
            closed: false,
            active,
          })
        : await fetchGammaMarketsKeyset({
            limit,
            afterCursor,
            order,
            ascending,
            closed: false,
            active,
          });
      const visibleItems = result.items.filter((item) => isMarketActive(item));

      res.json({
        items: visibleItems,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      console.error('[markets] list failed', { tagSlug, limit, afterCursor }, err);
      res.status(502).json({ error: 'polymarket_api_error' });
    }
  });

  router.get('/:conditionId/metrics', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const parsedQuery = metricsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    const metrics = await resolveMarketMetrics(parsedId.data, {
      assetId: parsedQuery.data.assetId,
      includeHistory: parsedQuery.data.includeHistory ?? false,
      cryptoSymbol: parsedQuery.data.cryptoSymbol,
      interval: parsedQuery.data.interval ?? null,
    });

    if (!metrics) {
      res.status(404).json({ error: 'market_not_found' });
      return;
    }

    res.json(metrics);
  });

  router.get('/:conditionId/ticks', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const limit = Math.min(Number(req.query.limit ?? '1000'), 10000);
    const offset = Math.max(Number(req.query.offset ?? '0'), 0);
    if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
      res.status(400).json({ error: 'invalid_pagination' });
      return;
    }
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);
    if (from === 'invalid' || to === 'invalid') {
      res.status(400).json({ error: 'invalid_date' });
      return;
    }
    const copiedPositionId = req.query.positionId
      ? Number(req.query.positionId)
      : undefined;
    if (copiedPositionId != null && !Number.isFinite(copiedPositionId)) {
      res.status(400).json({ error: 'invalid_position_id' });
      return;
    }

    const result = await new MarketPositionTickService(ds).listByMarket(parsedId.data, {
      limit,
      offset,
      from,
      to,
      copiedPositionId,
    });
    res.json(result);
  });

  return router;
}
