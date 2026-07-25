import { Router } from 'express';
import type { E2eSuiteId } from '@polywatch/core';
import { requireJwt, type AuthRequest } from '../middleware/auth.js';
import type { E2eRunnerService } from '../services/e2e-runner.service.js';
import {
  E2E_SUITES,
  E2eRunnerBusyError,
  E2eRunnerInvalidSuiteError,
  E2eRunnerNotActiveError,
  E2eRunnerSpawnError,
  e2ePositionToDto,
  e2eRunToDto,
  isValidSuiteId,
} from '../services/e2e-runner.service.js';

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function parsePagination(query: { limit?: unknown; offset?: unknown }) {
  const limit = Math.min(Math.max(1, Number(query.limit ?? 50)), 200);
  const offset = Math.max(0, Number(query.offset ?? 0));
  return { limit, offset };
}

export function createE2eRunsRouter(runner: E2eRunnerService): Router {
  const router = Router();

  router.get('/suites', requireJwt, (_req, res) => {
    res.json(
      E2E_SUITES.map(({ id, label, description, requiresConfirmation }) => ({
        id,
        label,
        description,
        requiresConfirmation: requiresConfirmation ?? false,
      })),
    );
  });

  // /suites/overview doit être déclaré AVANT /:id pour éviter le conflit de routing
  router.get('/suites/overview', requireJwt, async (_req, res) => {
    const lastRunPerSuite = await runner.getLastRunPerSuite();
    res.json(
      E2E_SUITES.map((suite) => {
        const { id, label, description, requiresConfirmation } = suite;
        const lastRun = lastRunPerSuite[id];
        return {
          suite: {
            id,
            label,
            description,
            requiresConfirmation: requiresConfirmation ?? false,
          },
          lastRun: lastRun ? e2eRunToDto(lastRun) : null,
        };
      }),
    );
  });

  router.get('/active', requireJwt, async (_req, res) => {
    const run = await runner.getActiveRun();
    res.json({ run: run ? e2eRunToDto(run) : null });
  });

  router.get('/', requireJwt, async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const result = await runner.listRuns(limit, offset);
    res.json({
      items: result.items.map(e2eRunToDto),
      total: result.total,
      limit,
      offset,
    });
  });

  router.get('/:id/positions', requireJwt, async (req, res) => {
    const runId = paramId(req.params.id);
    const run = await runner.getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const positions = await runner.getRunPositions(runId);
    res.json(positions.map(e2ePositionToDto));
  });

  router.get('/:id/logs', requireJwt, async (req, res) => {
    const run = await runner.getRun(paramId(req.params.id));
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const tail = req.query.tail ? Number(req.query.tail) : undefined;
    res.type('text/plain').send(runner.readLogTail(run.logFilePath, tail));
  });

  router.get('/:id', requireJwt, async (req, res) => {
    const run = await runner.getRun(paramId(req.params.id));
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(e2eRunToDto(run));
  });

  router.post('/', requireJwt, async (req: AuthRequest, res) => {
    const suite = req.body?.suite as string | undefined;
    if (!suite || !isValidSuiteId(suite)) {
      res.status(400).json({ error: 'invalid_suite' });
      return;
    }

    try {
      const run = await runner.startRun(suite as E2eSuiteId, req.user?.username);
      res.status(201).json(e2eRunToDto(run));
    } catch (err) {
      if (err instanceof E2eRunnerBusyError) {
        res.status(409).json({
          error: 'run_in_progress',
          existingRunId: err.existingRunId ?? null,
        });
        return;
      }
      if (err instanceof E2eRunnerInvalidSuiteError) {
        res.status(400).json({ error: 'invalid_suite' });
        return;
      }
      if (err instanceof E2eRunnerSpawnError) {
        res.status(500).json({ error: 'spawn_failed', message: err.message });
        return;
      }
      throw err;
    }
  });

  router.post('/:id/cancel', requireJwt, async (req, res) => {
    try {
      const run = await runner.cancelRun(paramId(req.params.id));
      if (!run) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(e2eRunToDto(run));
    } catch (err) {
      if (err instanceof E2eRunnerNotActiveError) {
        res.status(409).json({ error: 'not_cancellable_here' });
        return;
      }
      throw err;
    }
  });

  return router;
}
