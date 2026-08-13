import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  BacktestRunService,
  WeatherConfigService,
  WeatherBucketTick,
  WeatherMarketSnapshot,
  BACKTEST_EXIT_REASONS,
  type BacktestRun,
  type BacktestExitReason,
  type WeatherConfig,
} from '@polywatch/core';
import {
  runBacktest,
  parseBacktestParams,
  BACKTEST_ENGINE_VERSION,
  type BacktestRunParams,
} from '@polywatch/backtest';
import { requireJwt } from '../middleware/auth.js';
import { parseLimit, parseOffset, parseOptionalDate } from './lib/query-params.js';
import pino from 'pino';

const log = pino({ name: 'backend:backtest' });

const BACKTEST_TIMEOUT_MS = Number(process.env.BACKTEST_TIMEOUT_MS ?? 30 * 60 * 1000);

interface RunTracker {
  cancelled: boolean;
  timedOut: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * In-process backtest job registry. A single run per domain can be active at
 * a time (singleton lock enforced by BacktestRunService.hasActiveRun).
 */
const activeRuns = new Map<number, RunTracker>();

/** Best-effort cancel of all in-flight runs (graceful shutdown). */
export function cancelAllActiveBacktestRuns(): void {
  for (const tracker of activeRuns.values()) {
    tracker.cancelled = true;
    if (tracker.timeoutId) clearTimeout(tracker.timeoutId);
  }
}

function parseExitReason(value: unknown): BacktestExitReason | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (BACKTEST_EXIT_REASONS as readonly string[]).includes(value)
    ? (value as BacktestExitReason)
    : null;
}

export function createBacktestRouter(ds: DataSource): Router {
  const router = Router();
  const service = new BacktestRunService(ds);
  const weatherConfigService = new WeatherConfigService(ds);

  // ── Data coverage ──────────────────────────────────────────────────────
  router.get('/data-coverage', requireJwt, async (req, res) => {
    const fidelityMinutesRaw = Number(req.query.fidelityMinutes);
    const fidelityMinutes =
      Number.isFinite(fidelityMinutesRaw) && fidelityMinutesRaw > 0
        ? Math.floor(fidelityMinutesRaw)
        : undefined;
    const rangeQb = ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .select('MIN(t.recordedAt)', 'from')
      .addSelect('MAX(t.recordedAt)', 'to')
      .addSelect('COUNT(*)', 'count');
    if (fidelityMinutes != null) {
      rangeQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
    }
    const range = await rangeQb.getRawOne<{ from: Date | null; to: Date | null; count: string }>();
    const citiesRows = await ds
      .getRepository(WeatherMarketSnapshot)
      .createQueryBuilder('s')
      .select('DISTINCT s.city', 'city')
      .orderBy('s.city', 'ASC')
      .getRawMany<{ city: string }>();
    res.json({
      from: range?.from ? new Date(range.from).toISOString() : null,
      to: range?.to ? new Date(range.to).toISOString() : null,
      totalTicks: Number(range?.count ?? 0),
      cities: citiesRows.map((r) => r.city),
    });
  });

  // ── Launch a run ───────────────────────────────────────────────────────
  router.post('/runs', requireJwt, async (req, res) => {
    let params: BacktestRunParams;
    try {
      params = parseBacktestParams(req.body);
    } catch (err) {
      res.status(400).json({ error: 'invalid_params', detail: (err as Error).message });
      return;
    }

    // Singleton lock: no concurrent run for the same domain.
    const active = await service.hasActiveRun('weather');
    if (active) {
      res.status(409).json({ error: 'run_already_active', runId: active.id });
      return;
    }

    const config = await weatherConfigService.getConfig();
    const run = await service.create({
      domain: 'weather',
      mode: params.mode,
      paramsJson: JSON.stringify(params),
      configSnapshotJson: JSON.stringify(config),
      configFingerprint: computeConfigFingerprint(config),
      engineVersion: BACKTEST_ENGINE_VERSION,
      label: params.label ?? null,
    });

    const tracker: RunTracker = { cancelled: false, timedOut: false };
    activeRuns.set(run.id, tracker);

    tracker.timeoutId = setTimeout(() => {
      tracker.timedOut = true;
    }, BACKTEST_TIMEOUT_MS);

    void (async () => {
      try {
        await runBacktest({
          runId: run.id,
          ds,
          params,
          configSnapshot: config,
          service,
          getAbortReason: () => {
            if (tracker.timedOut) return 'timeout';
            if (tracker.cancelled) return 'cancelled';
            return null;
          },
        });
      } catch (err) {
        log.error({ runId: run.id, err }, 'backtest run failed');
        await service.markFailed(run.id, (err as Error).message ?? String(err));
      } finally {
        if (tracker.timeoutId) clearTimeout(tracker.timeoutId);
        activeRuns.delete(run.id);
      }
    })();

    res.status(202).json({ id: run.id, status: run.status });
  });

  // ── List runs ──────────────────────────────────────────────────────────
  router.get('/runs', requireJwt, async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 100);
    const offset = parseOffset(req.query.offset);
    const domain = typeof req.query.domain === 'string' ? req.query.domain : 'weather';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const { items, total } = await service.list({
      domain: domain as 'weather',
      status: status as BacktestRun['status'] | undefined,
      limit,
      offset,
    });
    res.json({ items: items.map(toRunDto), total });
  });

  // ── Get a single run ───────────────────────────────────────────────────
  router.get('/runs/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toRunDto(run));
  });

  // ── Cancel a run ───────────────────────────────────────────────────────
  router.post('/runs/:id/cancel', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (run.status === 'running' || run.status === 'queued') {
      const tracker = activeRuns.get(id);
      if (tracker) {
        tracker.cancelled = true;
      }
      res.json({ id, status: 'cancelling' });
    } else {
      res.status(400).json({ error: 'not_cancellable', status: run.status });
    }
  });

  // ── Delete a run (and its positions/equity) ────────────────────────────
  router.delete('/runs/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (run.status === 'running' || run.status === 'queued') {
      res.status(409).json({ error: 'run_still_active', status: run.status });
      return;
    }
    await service.delete(id);
    activeRuns.delete(id);
    res.json({ id, deleted: true });
  });

  // ── Positions of a run ─────────────────────────────────────────────────
  router.get('/runs/:id/positions', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset);
    const exitReason = parseExitReason(req.query.exitReason);
    const { items, total } = await service.listPositions(id, { limit, offset, exitReason });
    res.json({ items, total });
  });

  // ── Equity curve of a run ──────────────────────────────────────────────
  router.get('/runs/:id/equity', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const points = await service.listEquity(id);
    res.json({
      points: points.map((p) => ({
        t: p.t.toISOString(),
        equity: p.equity,
        cash: p.cash,
        openPositions: p.openPositions,
      })),
    });
  });

  return router;
}

/** Orphan recovery: mark runs stuck in running/queued as failed on boot. */
export async function recoverOrphanedBacktestRuns(ds: DataSource): Promise<void> {
  await new BacktestRunService(ds).markOrphanedRunningAsFailed();
}

function computeConfigFingerprint(config: WeatherConfig): string {
  const relevant = Object.keys(config as unknown as Record<string, unknown>)
    .filter((k) => k.startsWith('weatherAlgo'))
    .sort()
    .map((k) => `${k}=${String((config as unknown as Record<string, unknown>)[k])}`)
    .join('|');
  let hash = 0;
  for (let i = 0; i < relevant.length; i++) {
    hash = (hash << 5) - hash + relevant.charCodeAt(i);
    hash |= 0;
  }
  return `cfg:${Math.abs(hash).toString(36)}`;
}

interface RunDto {
  id: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  progressPct: number;
  domain: string;
  mode: string;
  label: string | null;
  params: unknown;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  stats: unknown;
  fidelityWarnings: unknown;
  engineVersion: string | null;
  error: string | null;
}

function toRunDto(run: BacktestRun): RunDto {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    status: run.status,
    progressPct: run.progressPct,
    domain: run.domain,
    mode: run.mode,
    label: run.label,
    params: safeParseJson(run.paramsJson),
    dataRangeFrom: run.dataRangeFrom ? run.dataRangeFrom.toISOString() : null,
    dataRangeTo: run.dataRangeTo ? run.dataRangeTo.toISOString() : null,
    stats: safeParseJson(run.statsJson),
    fidelityWarnings: safeParseJson(run.fidelityWarningsJson),
    engineVersion: run.engineVersion,
    error: run.error,
  };
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
