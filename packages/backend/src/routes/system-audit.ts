import { Router } from 'express';
import { requireJwt } from '../middleware/auth.js';
import {
  isValidAuditScriptId,
  isDangerousScript,
  getActiveRun,
  runAuditScript,
  killAllAuditProcesses,
} from '../services/system-audit-runner.js';

export function createSystemAuditRouter(): Router {
  const router = Router();

  router.post('/audit', requireJwt, (req, res) => {
    const { script, confirm } = req.body ?? {};

    if (typeof script !== 'string' || !isValidAuditScriptId(script)) {
      res.status(400).json({ error: 'Script d\'audit invalide' });
      return;
    }

    if (isDangerousScript(script) && confirm !== true) {
      res.status(400).json({
        error: 'Ce script est dangereux. Confirmez avec confirm: true.',
      });
      return;
    }

    // Verrou par script : 409 si déjà en cours
    const existing = getActiveRun(script);
    if (existing) {
      res.status(409).json({
        error: 'Un audit est déjà en cours pour ce script',
        existingRunId: existing.runId,
      });
      return;
    }

    const { runId } = runAuditScript(script);
    res.status(202).json({ runId });
  });

  return router;
}
