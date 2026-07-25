import { Router } from 'express';
import { z } from 'zod';
import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  RiskService,
  SimulationArchiveService,
  SimulationSessionService,
  SimulationService,
  SimulationResetArchiveService,
  resolveSimResetAmount,
  type SimArchiveSummary,
  CopiedPosition,
  CopiedPositionPresenter,
  WatchlistEntry,
  buildTraderAnalytics,
  buildTraderPnlSeriesResponse,
  buildPnlByMarketCategory,
  buildMarketAnalytics,
  aggregateMarketAnalyticsTotals,
  buildMarketPnlSeriesResponse,
  SimulationStateSnapshot,
  SimulationBalance,
  safeParseJson,
  collectSimRedisPurgeHints,
  purgeSimExecutionRedisState,
  type SimResetRedisPurgeResult,
  publishSimulationReset,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { emitSimSnapshot } from '../notify/simulation.js';
import { publishConfigChanged, getRedis } from '../redis.js';
import { emitSimulationReset, emitSimulationSnapshotCreated } from '../websocket.js';
import {
  recordSnapshotCreated,
  recordSnapshotCount,
  recordApiRouteDuration,
} from '../metrics.js';

export function createSimulationRouter(ds: DataSource): Router {
  const log = pino({ name: 'simulation-routes' });
  const router = Router();
  const simulationService = new SimulationService(ds);
  const archiveService = new SimulationArchiveService(ds);
  const sessionService = new SimulationSessionService(ds);
  const resetArchiveService = new SimulationResetArchiveService(ds);
  const riskService = new RiskService(ds);

  const resetBodySchema = z
    .object({
      amount: z.number().finite().nonnegative().optional(),
      archive: z.boolean().default(true),
      deepClean: z.boolean().default(false),
      newSessionLabel: z.string().max(200).nullable().optional(),
    })
    .strict();

  async function refreshSnapshotCount(): Promise<void> {
    recordSnapshotCount(await archiveService.countSnapshots(), 'sim');
  }
  const presenter = new CopiedPositionPresenter(ds);

  async function timeRoute<T>(route: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      recordApiRouteDuration(route, performance.now() - start);
    }
  }

  router.get('/simulation/analytics', requireJwt, async (req, res) => {
    await timeRoute('GET /api/simulation/analytics', async () => {
      const watchlistSimOnlyParsed = z
        .enum(['true', 'false'])
        .optional()
        .safeParse(req.query.watchlistSimOnly);
      const watchlistIdParsed = z.coerce.number().int().positive().optional().safeParse(
        req.query.watchlistId,
      );
      const watchlistSimOnly =
        watchlistSimOnlyParsed.success
          ? watchlistSimOnlyParsed.data !== 'false'
          : true;
      const watchlistId = watchlistIdParsed.success
        ? watchlistIdParsed.data
        : undefined;

      const [positions, watchlist] = await Promise.all([
        ds.getRepository(CopiedPosition).find({ where: { mode: 'sim' } }),
        ds.getRepository(WatchlistEntry).find(),
      ]);
      const enriched = await presenter.enrich(positions);
      const simWatchlistIds = new Set(
        watchlist.filter((entry) => entry.simEnabled).map((entry) => entry.id),
      );

      let positionsForCategory = enriched;
      if (watchlistId != null) {
        positionsForCategory = enriched.filter((p) => p.watchlistId === watchlistId);
      } else if (watchlistSimOnly) {
        positionsForCategory = enriched.filter((p) =>
          simWatchlistIds.has(p.watchlistId),
        );
      }

      res.json({
        traders: buildTraderAnalytics(watchlist, enriched),
        pnlByCategory: buildPnlByMarketCategory(positionsForCategory),
      });
    });
  });

  router.get('/simulation/analytics/trader-pnl-series', requireJwt, async (req, res) => {
    await timeRoute('GET /api/simulation/analytics/trader-pnl-series', async () => {
      const parsed = z
        .object({
          watchlistId: z.coerce.number().int().positive(),
          conditionId: z.string().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(2000).default(500),
        })
        .safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_query' });
        return;
      }

      const { watchlistId, conditionId, limit } = parsed.data;

      const snapshotRows = await ds
        .getRepository(SimulationStateSnapshot)
        .createQueryBuilder('s')
        .select(['s.id', 's.createdAt', 's.tradersJson', 's.positionsJson'])
        .orderBy('s.createdAt', 'DESC')
        .addOrderBy('s.id', 'DESC')
        .take(limit)
        .getMany();

      snapshotRows.reverse();

      const snapshots = snapshotRows.flatMap((row) => {
        const traders = safeParseJson(row.tradersJson, null);
        const positions = safeParseJson(row.positionsJson, null);
        if (traders === null || positions === null) {
          log.warn({ snapshotId: row.id }, 'corrupt snapshot row skipped');
          return [];
        }
        return [{
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          traders,
          positions,
        }];
      });

      const positions = await ds.getRepository(CopiedPosition).find({
        where: { mode: 'sim' },
      });
      const enriched = await presenter.enrich(positions);

      res.json(
        buildTraderPnlSeriesResponse({
          snapshots,
          watchlistId,
          conditionId: conditionId ?? null,
          livePositions: enriched,
        }),
      );
    });
  });

  router.get('/simulation/analytics/market', requireJwt, async (req, res) => {
    await timeRoute('GET /api/simulation/analytics/market', async () => {
      const watchlistSimOnlyParsed = z
        .enum(['true', 'false'])
        .optional()
        .safeParse(req.query.watchlistSimOnly);
      const watchlistIdParsed = z.coerce.number().int().positive().optional().safeParse(
        req.query.watchlistId,
      );
      const watchlistSimOnly =
        watchlistSimOnlyParsed.success
          ? watchlistSimOnlyParsed.data !== 'false'
          : true;
      const watchlistId = watchlistIdParsed.success
        ? watchlistIdParsed.data
        : undefined;

      const [positions, watchlist] = await Promise.all([
        ds.getRepository(CopiedPosition).find({ where: { mode: 'sim' } }),
        ds.getRepository(WatchlistEntry).find(),
      ]);
      const enriched = await presenter.enrich(positions);
      const simWatchlistIds = new Set(
        watchlist.filter((entry) => entry.simEnabled).map((entry) => entry.id),
      );

      let filteredPositions = enriched;
      if (watchlistId != null) {
        filteredPositions = enriched.filter((p) => p.watchlistId === watchlistId);
      } else if (watchlistSimOnly) {
        filteredPositions = enriched.filter((p) =>
          simWatchlistIds.has(p.watchlistId),
        );
      }

      const markets = buildMarketAnalytics(filteredPositions);
      const totals = aggregateMarketAnalyticsTotals(markets);

      res.json({ markets, totals });
    });
  });

  router.get('/simulation/analytics/market-pnl-series', requireJwt, async (req, res) => {
    await timeRoute('GET /api/simulation/analytics/market-pnl-series', async () => {
      const parsed = z
        .object({
          conditionId: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(2000).default(500),
        })
        .safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_query' });
        return;
      }

      const { conditionId, limit } = parsed.data;

      const snapshotRows = await ds
        .getRepository(SimulationStateSnapshot)
        .createQueryBuilder('s')
        .select(['s.id', 's.createdAt', 's.tradersJson', 's.positionsJson'])
        .orderBy('s.createdAt', 'DESC')
        .addOrderBy('s.id', 'DESC')
        .take(limit)
        .getMany();

      snapshotRows.reverse();

      const snapshots = snapshotRows.flatMap((row) => {
        const positions = safeParseJson(row.positionsJson, null);
        if (positions === null) {
          log.warn({ snapshotId: row.id }, 'corrupt snapshot row skipped');
          return [];
        }
        return [{
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          positions,
        }];
      });

      const positions = await ds.getRepository(CopiedPosition).find({
        where: { mode: 'sim' },
      });
      const enriched = await presenter.enrich(positions);

      res.json(
        buildMarketPnlSeriesResponse({
          snapshots,
          conditionId,
          livePositions: enriched,
        }),
      );
    });
  });

  router.get('/simulation-balance', requireJwt, async (_req, res) => {
    res.json(await simulationService.getSnapshot());
  });

  router.post('/simulation-balance/reset', requireJwt, async (req, res) => {
    const parsedBody = resetBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const body = parsedBody.data;

    // Lock against concurrent resets (Redis SET NX PX)
    const LOCK_KEY = 'sim:reset:lock';
    const LOCK_TTL_MS = 10_000;
    let acquired: string | null;
    try {
      acquired = await getRedis().set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    } catch (err) {
      log.error({ err }, 'failed to acquire reset lock');
      res.status(503).json({ error: 'reset_lock_unavailable' });
      return;
    }
    if (acquired !== 'OK') {
      res.status(409).json({ error: 'reset_already_in_progress' });
      return;
    }
    try {
      const risk = await riskService.getConfig();
      const amount = resolveSimResetAmount(body.amount, risk.simInitialCapital);

      const before = await simulationService.getSnapshot();
      const resetSnapshot = await archiveService.createSnapshot({
        source: 'reset',
        label: 'Avant réinitialisation',
        skipIfEmpty: true,
      });
      if (resetSnapshot) {
        recordSnapshotCreated('reset', 'sim');
        emitSimulationSnapshotCreated();
        await refreshSnapshotCount();
      }

      const endingEquity = resetSnapshot?.equity ?? before.equity;
      const endingSessionPnl =
        resetSnapshot?.sessionPnl ?? before.equity - before.baselineCapital;

      // Collect hints before the transaction so we know which sim jobs to purge.
      // There is a narrow window between collection and purge where a new sim
      // position could be created — this would leave orphaned dedupe/cooldown
      // markers (the queue lists themselves are scanned by mode==='sim' at purge
      // time, so queued jobs are always removed regardless of hints).
      const redisPurgeHints = await collectSimRedisPurgeHints(ds);

      let archiveSummary: SimArchiveSummary | null = null;

      await ds.transaction(async (manager) => {
        const session = await sessionService.ensureActiveSession(manager);
        if (body.archive) {
          archiveSummary = await resetArchiveService.archiveSession(manager, session);
        }
        if (body.deepClean) {
          await resetArchiveService.purgeMarketData(manager);
        }
        await simulationService.resetWithManager(manager, amount);
        const balance = await manager
          .getRepository(SimulationBalance)
          .findOne({ where: {} });
        const sessionStartedAt = balance?.sessionStartedAt ?? new Date();
        await sessionService.rotateAfterReset(manager, {
          endingEquity,
          endingSessionPnl,
          newBaselineCapital: amount,
          sessionStartedAt,
          newSessionLabel: body.newSessionLabel ?? null,
        });
      });
      // resetWithManager may have updated simInitialCapital — drop stale cache.
      RiskService.invalidateConfigCache();

      const snapshot = await simulationService.getSnapshot();

      // Post-commit side-effects: each wrapped individually so a partial failure
      // does not prevent the HTTP response or leave the client guessing.
      const warnings: string[] = [];

      let redisPurge: SimResetRedisPurgeResult | null = null;
      try {
        redisPurge = await purgeSimExecutionRedisState(getRedis(), redisPurgeHints);
      } catch (err) {
        log.error({ err }, 'redis purge failed after reset — sim jobs may linger');
        warnings.push('redis_purge_failed');
      }

      const balanceRow = await ds.getRepository(SimulationBalance).findOne({ where: {} });

      try {
        emitSimulationReset();
        emitSimSnapshot(snapshot);
      } catch (err) {
        log.warn({ err }, 'ws emit failed after reset');
        warnings.push('ws_emit_failed');
      }

      try {
        await publishSimulationReset(getRedis(), {
          sessionStartedAt: balanceRow?.sessionStartedAt?.toISOString(),
        });
      } catch (err) {
        log.warn({ err }, 'publishSimulationReset failed');
        warnings.push('publish_reset_failed');
      }

      try {
        await publishConfigChanged();
      } catch (err) {
        log.warn({ err }, 'publishConfigChanged failed');
        warnings.push('publish_config_failed');
      }

      res.json({ ...snapshot, archiveSummary, redisPurge, warnings });
    } finally {
      await getRedis().del(LOCK_KEY).catch(() => {});
    }
  });

  router.get('/simulation-snapshots', requireJwt, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sourceParsed = z
      .enum(['manual', 'reset', 'auto'])
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

  router.get('/simulation-sessions', requireJwt, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const statusParsed = z.enum(['active', 'closed']).safeParse(req.query.status);
    const labelParsed = z.string().max(200).safeParse(req.query.label);
    const fromParsed = z.string().date().safeParse(req.query.from);
    const toParsed = z.string().date().safeParse(req.query.to);
    const live = await simulationService.getSnapshot();
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
        s.status === 'active'
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

  router.get('/simulation-sessions/current', requireJwt, async (_req, res) => {
    const live = await simulationService.getSnapshot();
    const current = await sessionService.getCurrentSession(live.equity);
    res.json(current);
  });

  router.get('/simulation-sessions/:id/archive', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const typeParsed = z
      .enum(['positions', 'executions', 'exit_attempts', 'surveillance', 'candles'])
      .safeParse(req.query.type);
    if (!typeParsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await resetArchiveService.getArchive(id, typeParsed.data, {
      limit,
      offset,
    });
    if (!result) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(result);
  });

  router.get('/simulation-sessions/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const live = await simulationService.getSnapshot();
    const session = await sessionService.getSession(id, live.equity);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(session);
  });

  router.patch('/simulation-sessions/:id', requireJwt, async (req, res) => {
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

  router.delete('/simulation-sessions/closed', requireJwt, async (_req, res) => {
    const result = await sessionService.deleteAllClosedSessions();
    await refreshSnapshotCount();
    emitSimulationSnapshotCreated();
    res.json(result);
  });

  router.delete('/simulation-sessions/:id', requireJwt, async (req, res) => {
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
      emitSimulationSnapshotCreated();
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'cannot_delete_active_session') {
        res.status(409).json({ error: 'cannot_delete_active_session' });
        return;
      }
      throw err;
    }
  });

  router.post('/simulation-snapshots', requireJwt, async (req, res) => {
    const parsed = z
      .object({ label: z.string().max(200).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const summary = await archiveService.createSnapshot({
      source: 'manual',
      label: parsed.data.label ?? null,
    });
    if (summary) {
      recordSnapshotCreated('manual', 'sim');
      emitSimulationSnapshotCreated();
      await refreshSnapshotCount();
    }
    res.status(summary ? 201 : 200).json(summary);
  });

  router.delete('/simulation-snapshots', requireJwt, async (_req, res) => {
    const deleted = await archiveService.deleteAllSnapshots();
    await refreshSnapshotCount();
    emitSimulationSnapshotCreated();
    res.json({ deleted });
  });

  router.get('/simulation-snapshots/:id', requireJwt, async (req, res) => {
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
