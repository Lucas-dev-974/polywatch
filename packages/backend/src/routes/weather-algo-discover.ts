import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { discoverWeatherMarkets, enrichCityGroupsWithForecast } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { recordWeatherQuestionParse } from '../metrics.js';

export function createWeatherAlgoDiscoverRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    try {
      // Always fetch 100 events from Gamma (the max) to ensure we find
      // today's and tomorrow's temperature markets, which may be deep
      // in the volume-sorted list. The date filter in discoverWeatherMarkets
      // will narrow the results to J/J+1.
      const result = await discoverWeatherMarkets({
        limit: 100,
        offset: Number.isFinite(offset) ? offset : 0,
        onParseResult: (parsed) => recordWeatherQuestionParse(parsed),
      });

      // Enrich city groups with Open-Meteo temperature forecasts for the UI headers.
      const byCity = await enrichCityGroupsWithForecast(ds, result.byCity, {
        metric: 'highest_temp',
      });

      res.json({
        ...result,
        byCity,
      });
    } catch (err) {
      res.status(500).json({
        error: 'discovery_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}
