import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { WeatherAlgoDataService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  return Math.max(1, Math.min(Number(value ?? fallback), max));
}

function parseOffset(value: unknown): number {
  return Math.max(0, Number(value ?? 0));
}

export function createWeatherAlgoDataRouter(ds: DataSource): Router {
  const router = Router();
  const service = new WeatherAlgoDataService(ds);

  router.get('/forecast-history', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(await service.listForecastHistory({ city, from, to, limit, offset }));
  });

  router.get('/market-snapshots', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const includeTicks =
      req.query.includeTicks === 'true' || req.query.includeTicks === '1';
    res.json(
      await service.listMarketSnapshots({ city, from, to, limit, offset, includeTicks }),
    );
  });

  router.get('/bucket-ticks', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(
      await service.listBucketTicks({ city, conditionId, from, to, limit, offset }),
    );
  });

  router.get('/evaluation-log', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const strategyId =
      typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined;
    const decision =
      typeof req.query.decision === 'string' ? req.query.decision : undefined;
    res.json(
      await service.listEvaluationLog({ from, to, strategyId, decision, limit, offset }),
    );
  });

  router.get('/forecast-cache', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(await service.listForecastCache({ city, from, to, limit, offset }));
  });

  router.get('/position-forecasts', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(await service.listPositionForecasts({ city, from, to, limit, offset }));
  });

  router.get('/clob-price-history', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    res.json(await service.listClobPriceHistory({ city, from, to, limit, offset }));
  });

  router.get('/tables', requireJwt, async (_req, res) => {
    res.json(await service.getTablesSummary());
  });

  router.get('/bucket-ticks/dates', requireJwt, async (_req, res) => {
    res.json(await service.listBucketTickDates());
  });

  router.get('/bucket-ticks/timeline', requireJwt, async (req, res) => {
    const targetDateIso =
      typeof req.query.targetDateIso === 'string' ? req.query.targetDateIso : '';
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const maxTicks = Number(req.query.maxTicks);
    res.json(
      await service.getBucketTicksTimeline({
        targetDateIso,
        city,
        from,
        to,
        maxTicks: Number.isFinite(maxTicks) ? maxTicks : undefined,
      }),
    );
  });

  router.get('/clob-price-history/dates', requireJwt, async (_req, res) => {
    res.json(await service.listClobPriceHistoryDates());
  });

  router.get('/clob-price-history/timeline', requireJwt, async (req, res) => {
    const targetDate =
      typeof req.query.targetDate === 'string' ? req.query.targetDate : '';
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const maxTicks = Number(req.query.maxTicks);
    res.json(
      await service.getClobPriceHistoryTimeline({
        targetDate,
        city,
        from,
        to,
        maxTicks: Number.isFinite(maxTicks) ? maxTicks : undefined,
      }),
    );
  });

  router.delete('/tables', requireJwt, async (_req, res) => {
    res.json(await service.deleteAllRecordedData());
  });

  router.get('/coverage', requireJwt, async (_req, res) => {
    res.json(await service.getCoverage());
  });

  return router;
}
