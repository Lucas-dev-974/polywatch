import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  AlgoPriceTickService,
  Market,
  parseMarketOutcomes,
  toOutcomeSideLabels,
  type OutcomeSideLabels,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { CONDITION_ID_PATTERN } from '../lib/condition-id.js';
import { computeTimeframeFrom, TIMEFRAMES } from '../lib/timeframe.js';
import { toTimestampMs } from '../lib/timestamp.js';

const conditionIdSchema = z.string().regex(CONDITION_ID_PATTERN);
const timeframeSchema = z
  .string()
  .refine((v) => (TIMEFRAMES as readonly string[]).includes(v), {
    message: `timeframe must be one of: ${TIMEFRAMES.join(', ')}`,
  })
  .optional();

export interface MarketChartPoint {
  t: number;
  up: number | null;
  down: number | null;
  metrics?: NonNullable<
    Awaited<ReturnType<AlgoPriceTickService['listTicks']>>[number]['metrics']
  >;
}

export interface MarketChartResponse {
  conditionId: string;
  points: MarketChartPoint[];
  outcomeLabels: OutcomeSideLabels | null;
}

async function loadOutcomeLabels(
  ds: DataSource,
  conditionId: string,
): Promise<OutcomeSideLabels | null> {
  const market = await ds.getRepository(Market).findOne({ where: { conditionId } });
  if (!market) return null;
  return toOutcomeSideLabels(parseMarketOutcomes(market.outcomes));
}

export function createAlgoMarketChartRouter(ds: DataSource): Router {
  const router = Router();
  const service = new AlgoPriceTickService(ds);

  router.get('/:conditionId', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const parsedTf = timeframeSchema.safeParse(req.query.timeframe);
    if (!parsedTf.success) {
      res.status(400).json({ error: 'invalid_timeframe' });
      return;
    }

    const from = parsedTf.data ? (computeTimeframeFrom(parsedTf.data) ?? undefined) : undefined;
    const ticks = await service.listTicks(parsedId.data, { from });
    const points: MarketChartPoint[] = ticks.map((t) => ({
      t: toTimestampMs(t.recordedAt),
      up: t.upPrice,
      down: t.downPrice,
      ...(t.metrics ? { metrics: t.metrics } : {}),
    }));

    const outcomeLabels = await loadOutcomeLabels(ds, parsedId.data);

    res.json({
      conditionId: parsedId.data,
      points,
      outcomeLabels,
    } satisfies MarketChartResponse);
  });

  return router;
}
