import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { AnalysisReportService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { recordApiRouteDuration } from '../metrics.js';

const generateSchema = z.object({
  type: z.literal('crypto_algo_optimize'),
  label: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  params: z
    .object({
      closedFrom: z.string().optional().nullable(),
      closedTo: z.string().optional().nullable(),
    })
    .optional(),
});

const updateMetaSchema = z.object({
  label: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export function createReportsRouter(ds: DataSource): Router {
  const router = Router();
  const service = new AnalysisReportService(ds);

  router.get('/', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const limit = req.query.limit != null ? Number(req.query.limit) : 50;
      const offset = req.query.offset != null ? Number(req.query.offset) : 0;
      const type =
        req.query.type === 'crypto_algo_optimize' ? 'crypto_algo_optimize' : undefined;
      const result = await service.list({
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
        type,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'reports_list_failed',
      });
    } finally {
      recordApiRouteDuration('GET /api/reports', performance.now() - start);
    }
  });

  router.get('/compare', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const idA = Number(req.query.a);
      const idB = Number(req.query.b);
      if (!Number.isFinite(idA) || !Number.isFinite(idB)) {
        res.status(400).json({ error: 'invalid_compare_ids' });
        return;
      }
      const result = await service.compare(idA, idB);
      if (!result) {
        res.status(404).json({ error: 'report_not_found' });
        return;
      }
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'compare_type_mismatch') {
        res.status(400).json({ error: 'compare_type_mismatch' });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'reports_compare_failed',
      });
    } finally {
      recordApiRouteDuration('GET /api/reports/compare', performance.now() - start);
    }
  });

  router.get('/:id', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const report = await service.getById(id);
      if (!report) {
        res.status(404).json({ error: 'report_not_found' });
        return;
      }
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'report_get_failed',
      });
    } finally {
      recordApiRouteDuration('GET /api/reports/:id', performance.now() - start);
    }
  });

  router.post('/generate', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_body',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
        return;
      }
      const report = await service.generateAndSave({
        type: parsed.data.type,
        label: parsed.data.label,
        note: parsed.data.note,
        params: {
          mode: 'sim',
          reason: 'ALGO_OPEN',
          closedFrom: parsed.data.params?.closedFrom ?? null,
          closedTo: parsed.data.params?.closedTo ?? null,
        },
      });
      res.status(201).json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'report_generate_failed',
      });
    } finally {
      recordApiRouteDuration('POST /api/reports/generate', performance.now() - start);
    }
  });

  router.patch('/:id', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = updateMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body' });
        return;
      }
      const report = await service.updateMeta(id, parsed.data);
      if (!report) {
        res.status(404).json({ error: 'report_not_found' });
        return;
      }
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'report_update_failed',
      });
    } finally {
      recordApiRouteDuration('PATCH /api/reports/:id', performance.now() - start);
    }
  });

  router.delete('/:id', requireJwt, async (req, res) => {
    const start = performance.now();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const ok = await service.delete(id);
      if (!ok) {
        res.status(404).json({ error: 'report_not_found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'report_delete_failed',
      });
    } finally {
      recordApiRouteDuration('DELETE /api/reports/:id', performance.now() - start);
    }
  });

  return router;
}
