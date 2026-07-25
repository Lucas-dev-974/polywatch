import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { WeatherForecastService, fetchWeatherForecast } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createWeatherAlgoForecastsRouter(ds: DataSource): Router {
  const router = Router();
  const forecastService = new WeatherForecastService(ds);
  const ttlMs = Number(process.env.WEATHER_FORECAST_CACHE_TTL_MS ?? 3600000);

  router.get('/:city/:date', requireJwt, async (req, res) => {
    const city = String(req.params.city);
    const dateStr = String(req.params.date);
    const metricRaw = String(req.query.metric ?? 'highest_temp');

    if (metricRaw !== 'highest_temp' && metricRaw !== 'lowest_temp') {
      res.status(400).json({
        error: 'invalid_metric',
        message: `metric must be 'highest_temp' or 'lowest_temp'`,
      });
      return;
    }
    const metric = metricRaw as 'highest_temp' | 'lowest_temp';

    const forecastDate = new Date(dateStr);
    if (Number.isNaN(forecastDate.getTime())) {
      res.status(400).json({
        error: 'invalid_date',
        message: `Invalid date: ${dateStr}`,
      });
      return;
    }

    try {
      // Check cache first
      const cached = await forecastService.getCached(city, forecastDate, metric);
      if (cached && cached.isFresh) {
        res.json(cached);
        return;
      }

      // Fall back to live fetch
      const fresh = await fetchWeatherForecast(city, forecastDate, metric);
      if (!fresh) {
        // Return stale cache if available, else 404
        if (cached) {
          res.json(cached);
          return;
        }
        res.status(404).json({
          error: 'forecast_unavailable',
          message: `No forecast available for ${city} on ${dateStr}`,
        });
        return;
      }

      const result = {
        city,
        forecastDate,
        metric,
        forecastMean: fresh.forecastMean,
        forecastStdDev: fresh.forecastStdDev,
        modelValues: fresh.modelValues,
        latitude: fresh.latitude,
        longitude: fresh.longitude,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        isFresh: true,
      };

      // Save to cache (fire and forget)
      forecastService.save(result).catch(() => {
        // Cache save failure is non-fatal
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: 'forecast_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}