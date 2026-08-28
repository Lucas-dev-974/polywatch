import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  WeatherAlgoDataService,
  WEATHER_ALGO_DATA_TABLE_IDS,
  type WeatherAlgoDataTableId,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { parseLimit, parseOffset, parseOptionalDate } from './lib/query-params.js';

function isValidTableId(value: string): value is WeatherAlgoDataTableId {
  return (WEATHER_ALGO_DATA_TABLE_IDS as readonly string[]).includes(value);
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
    const mode = req.query.mode === 'sim' || req.query.mode === 'real' ? req.query.mode : undefined;
    res.json(
      await service.listEvaluationLog({ from, to, strategyId, decision, mode, limit, offset }),
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
    const conditionId =
      typeof req.query.conditionId === 'string' ? req.query.conditionId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const maxTicks = Number(req.query.maxTicks);
    const fidelityMinutesRaw = Number(req.query.fidelityMinutes);
    const fidelityMinutes =
      Number.isFinite(fidelityMinutesRaw) && fidelityMinutesRaw > 0
        ? Math.floor(fidelityMinutesRaw)
        : undefined;
    res.json(
      await service.getBucketTicksTimeline({
        targetDateIso,
        city,
        conditionId,
        from,
        to,
        maxTicks: Number.isFinite(maxTicks) ? maxTicks : undefined,
        fidelityMinutes,
      }),
    );
  });

  router.delete('/bucket-ticks/interval', requireJwt, async (req, res) => {
    const city = typeof req.query.city === 'string' ? req.query.city : '';
    const fidelityMinutes = Number(req.query.fidelityMinutes);
    if (!city || !Number.isFinite(fidelityMinutes) || fidelityMinutes <= 0) {
      res.status(400).json({ error: 'city and fidelityMinutes (>0) are required' });
      return;
    }
    const deleted = await service.deleteBucketTickCityInterval(city, fidelityMinutes);
    res.json({ city, fidelityMinutes, deleted });
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
    const fidelityMinutesRaw = Number(req.query.fidelityMinutes);
    const fidelityMinutes =
      Number.isFinite(fidelityMinutesRaw) && fidelityMinutesRaw > 0
        ? Math.floor(fidelityMinutesRaw)
        : undefined;
    res.json(
      await service.getClobPriceHistoryTimeline({
        targetDate,
        city,
        from,
        to,
        maxTicks: Number.isFinite(maxTicks) ? maxTicks : undefined,
        fidelityMinutes,
      }),
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
    res.json(await service.deleteTableData(id));
  });

  router.get('/coverage', requireJwt, async (_req, res) => {
    res.json(await service.getCoverage());
  });

  return router;
}
