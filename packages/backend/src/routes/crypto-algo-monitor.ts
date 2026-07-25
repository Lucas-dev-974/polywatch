import { Router } from 'express';
import { requireJwt } from '../middleware/auth.js';
import {
  getActiveCryptoAlgoMonitorRun,
  readLatestSnapshotFromDisk,
  startCryptoAlgoMonitor,
  stopCryptoAlgoMonitor,
} from '../services/crypto-algo-monitor.service.js';

export function createCryptoAlgoMonitorRouter(): Router {
  const router = Router();

  // GET / — returns the active run (if any) so the frontend can recover
  // state after a page reload. Must be declared before /:runId.
  router.get('/', requireJwt, async (_req, res) => {
    const run = getActiveCryptoAlgoMonitorRun();
    if (!run) {
      res.status(204).send();
      return;
    }
    const snapshot = run.latestSnapshot ?? (await readLatestSnapshotFromDisk(run.runId));
    res.json({
      runId: run.runId,
      startedAt: run.startedAt,
      durationHours: run.durationHours,
      intervalSeconds: run.intervalSeconds,
      finished: run.finished,
      exitCode: run.exitCode,
      error: run.error,
      logs: run.logs,
      latestSnapshot: snapshot,
    });
  });

  router.post('/', requireJwt, async (req, res) => {
    const { durationHours, intervalSeconds } = req.body ?? {};

    const existing = getActiveCryptoAlgoMonitorRun();
    if (existing && !existing.finished) {
      res.status(409).json({
        error: 'Un run de monitoring crypto-algo est déjà en cours',
        existingRunId: existing.runId,
      });
      return;
    }

    try {
      const result = await startCryptoAlgoMonitor({ durationHours, intervalSeconds });
      res.status(202).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Échec du démarrage du monitor';
      res.status(500).json({ error: message });
    }
  });

  router.get('/:runId', requireJwt, async (req, res) => {
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    const run = getActiveCryptoAlgoMonitorRun();

    if (!run || run.runId !== runId) {
      res.status(404).json({ error: 'Run non trouvé ou terminé' });
      return;
    }

    const snapshot = run.latestSnapshot ?? (await readLatestSnapshotFromDisk(runId));

    res.json({
      runId: run.runId,
      startedAt: run.startedAt,
      durationHours: run.durationHours,
      intervalSeconds: run.intervalSeconds,
      finished: run.finished,
      exitCode: run.exitCode,
      error: run.error,
      logs: run.logs,
      latestSnapshot: snapshot,
    });
  });

  router.post('/:runId/stop', requireJwt, async (req, res) => {
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    try {
      await stopCryptoAlgoMonitor(runId);
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Échec de l\'arrêt';
      res.status(400).json({ error: message });
    }
  });

  return router;
}
