import { Router } from 'express';
import { WEATHER_STRATEGY_CATALOG } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createWeatherAlgoStrategyCatalogRouter(): Router {
  const router = Router();

  router.get('/strategy-catalog', requireJwt, (_req, res) => {
    res.json({ strategies: WEATHER_STRATEGY_CATALOG });
  });

  return router;
}
