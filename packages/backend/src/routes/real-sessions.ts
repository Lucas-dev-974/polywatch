import { Router } from 'express';
import { z } from 'zod';
import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  RealArchiveService,
  RealSessionService,
  RealPeriodArchiveService,
  RealPortfolioService,
  withRealRotateLock,
  type RealArchiveSummary,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { fetchObservedWalletCash } from '../polymarket/observed-wallet-cash.js';
import {
  emitRealPeriodRotated,
  emitRealSnapshotCreated,
} from '../websocket.js';
import {
  recordSnapshotCreated,
  recordSnapshotCount,
  recordApiRouteDuration,
} from '../metrics.js';

export function createRealSessionsRouter(ds: DataSource): Router {
  const log = pino({ name: 'real-sessions-routes' });
  const router = Router();
  const archiveService = new RealArchiveService(ds);
  const sessionService = new RealSessionService(ds);
  const periodArchiveService = new RealPeriodArchiveService(ds);
  const portfolioService = new RealPortfolioService(ds);

  const rotateBodySchema = z
    .object({
      archive: z.boolean().default(true),
      clearClosedLive: z.boolean().default(false),
      newPeriodLabel: z.string().max(200).nullable().optional(),
    })
    .strict();

  async function refreshSnapshotCount(): Promise<void> {
    recordSnapshotCount(await archiveService.countSnapshots(), 'real');
  }

  async function timeRoute<T>(route: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      recordApiRouteDuration(route, performance.now() - start);
    }
  }

  async function resolveLivePortfolio() {
    const observedCash = await fetchObservedWalletCash(ds);
    if (observedCash == null) return null;
    return portfolioService.getSnapshot(ds.manager, observedCash);
  }

  router.get('/real-snapshots', requireJwt, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sourceParsed = z
      .enum(['manual', 'auto', 'rotate'])
      .safeParse(req.query.source);
    const sessionIdParsed = z.coerce.number().int().positive().safeParse(req.query.sessionId);
    const labelParsed = z.string().max(200).safeParse(req.query.label);
    const fromParsed = z.string().date().safeParse(req.query.from);
    const toParsed = z.string().date().safeParse(req.query.to);
    res.json(
      await archiveService.listSnapshots({
        limit,
        offset,
        source: sourceParsed.success ? sourceParsed.data : undefined,
        sessionId: sessionIdParsed.success ? sessionIdParsed.data : undefined,
        label: labelParsed.success ? labelParsed.data : undefined,
        from: fromParsed.success ? fromParsed.data : undefined,
        to: toParsed.success ? toParsed.data : undefined,
      }),
    );
  });

  router.get('/real-sessions', requireJwt, async (req, res) => {
    await timeRoute('GET /api/real-sessions', async () => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const statusParsed = z.enum(['active', 'closed']).safeParse(req.query.status);
      const labelParsed = z.string().max(200).safeParse(req.query.label);
      const fromParsed = z.string().date().safeParse(req.query.from);
      const toParsed = z.string().date().safeParse(req.query.to);
      const live = await resolveLivePortfolio();
      const result = await sessionService.listSessions({
        limit,
        offset,
        status: statusParsed.success ? statusParsed.data : undefined,
        label: labelParsed.success ? labelParsed.data : undefined,
        from: fromParsed.success ? fromParsed.data : undefined,
        to: toParsed.success ? toParsed.data : undefined,
      });
      res.json({
        items: result.items.map((s) =>
          s.status === 'active' && live
            ? {
                ...s,
                sessionPnl: live.equity - s.baselineCapital,
                endingEquity: live.equity,
              }
            : s,
        ),
        total: result.total,
      });
    });
  });

  router.get('/real-sessions/current', requireJwt, async (_req, res) => {
    const live = await resolveLivePortfolio();
    const current = await sessionService.getCurrentSession(live?.equity ?? null);
    res.json(current);
  });

  router.get('/real-sessions/:id/archive', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const typeParsed = z
      .enum(['positions', 'executions', 'exit_attempts'])
      .safeParse(req.query.type);
    if (!typeParsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await periodArchiveService.getArchive(id, typeParsed.data, {
      limit,
      offset,
    });
    if (!result) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(result);
  });

  router.get('/real-sessions/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const live = await resolveLivePortfolio();
    const session = await sessionService.getSession(id, live?.equity ?? null);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(session);
  });

  router.patch('/real-sessions/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const parsed = z
      .object({
        label: z.string().max(200).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const updated = await sessionService.updateSession(id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/real-sessions/closed', requireJwt, async (_req, res) => {
    const result = await sessionService.deleteAllClosedSessions();
    await refreshSnapshotCount();
    emitRealSnapshotCreated();
    res.json(result);
  });

  router.delete('/real-sessions/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const deleteSnapshots = req.query.deleteSnapshots === 'true';
    try {
      const result = await sessionService.deleteSession(id, { deleteSnapshots });
      if (!result.deleted) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (deleteSnapshots) await refreshSnapshotCount();
      emitRealSnapshotCreated();
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'cannot_delete_active_session') {
        res.status(409).json({ error: 'cannot_delete_active_session' });
        return;
      }
      throw err;
    }
  });

  router.post('/real-sessions/rotate', requireJwt, async (req, res) => {
    const parsedBody = rotateBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const body = parsedBody.data;

    const observedCash = await fetchObservedWalletCash(ds);
    if (observedCash == null) {
      res.status(503).json({ error: 'wallet_unavailable' });
      return;
    }

    const before = await portfolioService.getSnapshot(ds.manager, observedCash);
    const rotateSnapshot = await archiveService.createSnapshot({
      source: 'rotate',
      label: 'Avant clôture de période',
      observedCash,
      skipIfEmpty: true,
    });
    if (rotateSnapshot) {
      recordSnapshotCreated('rotate', 'real');
      emitRealSnapshotCreated();
      await refreshSnapshotCount();
    }

    const endingEquity = rotateSnapshot?.equity ?? before.equity;
    const endingSessionPnl =
      rotateSnapshot?.sessionPnl ?? before.equity - before.baselineCapital;

    let archiveSummary: RealArchiveSummary | null = null;

    try {
      await withRealRotateLock(ds, async (manager) => {
        const session = await sessionService.ensureActiveSession(manager);
        const rotateAt = new Date();

        if (body.archive) {
          const archived = await periodArchiveService.archiveClosedInWindow(
            manager,
            session,
            rotateAt,
          );
          archiveSummary = archived.summary;
          if (body.clearClosedLive && archived.archivedPositionIds.length > 0) {
            await periodArchiveService.clearArchivedLive(
              manager,
              archived.archivedPositionIds,
            );
          }
        }

        await sessionService.rotateAfterClose(manager, {
          endingEquity,
          endingSessionPnl,
          newBaselineCapital: endingEquity,
          periodStartedAt: rotateAt,
          newSessionLabel: body.newPeriodLabel ?? null,
          observedCash,
        });
      });
    } catch (err) {
      log.warn({ err }, 'real period rotate failed');
      throw err;
    }

    emitRealPeriodRotated();
    res.json({ archiveSummary, endingEquity, endingSessionPnl });
  });

  router.post('/real-snapshots', requireJwt, async (req, res) => {
    const parsed = z
      .object({ label: z.string().max(200).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const observedCash = await fetchObservedWalletCash(ds);
    if (observedCash == null) {
      res.status(503).json({ error: 'wallet_unavailable' });
      return;
    }

    const summary = await archiveService.createSnapshot({
      source: 'manual',
      label: parsed.data.label ?? null,
      observedCash,
    });
    if (summary) {
      recordSnapshotCreated('manual', 'real');
      emitRealSnapshotCreated();
      await refreshSnapshotCount();
    }
    res.status(summary ? 201 : 200).json(summary);
  });

  router.delete('/real-snapshots', requireJwt, async (_req, res) => {
    const deleted = await archiveService.deleteAllSnapshots();
    await refreshSnapshotCount();
    emitRealSnapshotCreated();
    res.json({ deleted });
  });

  router.get('/real-snapshots/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const detail = await archiveService.getSnapshotDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  });

  return router;
}
