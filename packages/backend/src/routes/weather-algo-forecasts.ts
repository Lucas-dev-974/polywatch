import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { WeatherForecastService, isWeatherMetric, type WeatherMetric } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createWeatherAlgoForecastsRouter(ds: DataSource): Router {
  const router = Router();
  const forecastService = new WeatherForecastService(ds);
  const ttlMs = Number(process.env.WEATHER_FORECAST_CACHE_TTL_MS ?? 3600000);

  router.get('/:city/:date', requireJwt, async (req, res) => {
    const city = String(req.params.city);
    const dateStr = String(req.params.date);
    const metricRaw = String(req.query.metric ?? 'highest_temp');

    if (!isWeatherMetric(metricRaw)) {
      res.status(400).json({
        error: 'invalid_metric',
        message: `metric must be 'highest_temp' or 'lowest_temp'`,
      });
      return;
    }
    const metric = metricRaw as WeatherMetric;

    const forecastDate = new Date(dateStr);
    if (Number.isNaN(forecastDate.getTime())) {
      res.status(400).json({
        error: 'invalid_date',
        message: `Invalid date: ${dateStr}`,
      });
      return;
    }

    try {
      const result = await forecastService.getOrFetch(city, forecastDate, metric, ttlMs);
      if (!result) {
        res.status(404).json({
          error: 'forecast_unavailable',
          message: `No forecast available for ${city} on ${dateStr}`,
        });
        return;
      }

      res.json({
        city,
        forecastDate,
        metric,
        forecastMean: result.forecastMean,
        forecastStdDev: result.forecastStdDev,
        modelValues: result.modelValues,
        latitude: result.latitude,
        longitude: result.longitude,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
        isFresh: result.isFresh,
      });
    } catch (err) {
      res.status(500).json({
        error: 'forecast_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}