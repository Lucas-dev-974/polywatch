import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  WeatherHistoryIngestService,
  WeatherHistoryIngestConflictError,
  isWeatherMetric,
  type WeatherMetric,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

const ingestBodySchema = z.object({
  city: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fidelityMinutes: z.number().int().min(1).max(1440),
  metric: z.custom<WeatherMetric>((v) => isWeatherMetric(v)).optional(),
});

export function createWeatherAlgoHistoryRouter(ds: DataSource): Router {
  const router = Router();
  const service = new WeatherHistoryIngestService(ds);

  void service.markInterruptedJobs().catch((err) => {
    console.warn('[weather-algo-history] markInterruptedJobs failed', err);
  });

  // Periodically recover jobs stuck in an active status (mid-ingest crash),
  // which would otherwise permanently block their city via the conflict guard.
  const STALE_JOB_MAX_AGE_MS = 60 * 60 * 1000; // 1 h
  const staleSweep = setInterval(() => {
    void service.markStaleJobs(STALE_JOB_MAX_AGE_MS).catch((err) => {
      console.warn('[weather-algo-history] markStaleJobs failed', err);
    });
  }, 10 * 60 * 1000); // every 10 min
  staleSweep.unref?.();

  router.get('/cities', requireJwt, async (_req, res) => {
    try {
      const cities = await service.listKnownCities();
      res.json({ cities });
    } catch (err) {
      res.status(500).json({
        error: 'cities_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  router.get('/coverage', requireJwt, async (req, res) => {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (!city) {
      res.status(400).json({ error: 'city_required' });
      return;
    }
    try {
      res.json(await service.getCoverage(city));
    } catch (err) {
      res.status(500).json({
        error: 'coverage_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  router.get('/jobs', requireJwt, async (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    try {
      res.json({ jobs: await service.listJobs(limit) });
    } catch (err) {
      res.status(500).json({
        error: 'jobs_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  router.get('/jobs/:id', requireJwt, async (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: 'invalid_job_id' });
      return;
    }
    try {
      const job = await service.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      res.json(job);
    } catch (err) {
      res.status(500).json({
        error: 'job_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  router.delete('/interval', requireJwt, async (req, res) => {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const fidelityMinutes = Number(req.query.fidelityMinutes);
    if (!city || !Number.isFinite(fidelityMinutes) || fidelityMinutes <= 0) {
      res.status(400).json({ error: 'invalid_params' });
      return;
    }
    try {
      const deleted = await service.deleteCityInterval(city, fidelityMinutes);
      res.json({ city, fidelityMinutes, deleted });
    } catch (err) {
      res.status(500).json({
        error: 'delete_interval_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  router.post('/ingest', requireJwt, async (req, res) => {
    const parsed = ingestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
      return;
    }

    try {
      const job = await service.startIngest({
        city: parsed.data.city,
        from: new Date(`${parsed.data.from}T00:00:00.000Z`),
        to: new Date(`${parsed.data.to}T00:00:00.000Z`),
        fidelityMinutes: parsed.data.fidelityMinutes,
        metric: parsed.data.metric,
      });

      void service.runJob(job.id).catch((err) => {
        console.warn('[weather-algo-history] runJob failed', err);
      });

      res.status(202).json({ jobId: job.id, job });
    } catch (err) {
      if (err instanceof WeatherHistoryIngestConflictError) {
        res.status(409).json({ error: 'job_conflict', message: err.message });
        return;
      }
      if (err instanceof Error && err.message === 'invalid_date_range') {
        res.status(400).json({ error: 'invalid_date_range' });
        return;
      }
      res.status(500).json({
        error: 'ingest_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}
