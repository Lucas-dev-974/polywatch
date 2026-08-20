import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  BacktestRunService,
  WeatherConfigService,
  WeatherBucketTick,
  WeatherMarketSnapshot,
  BACKTEST_EXIT_REASONS,
  parseWeatherQuestion,
  type BacktestRun,
  type BacktestExitReason,
} from '@polywatch/core';
import {
  runBacktest,
  parseBacktestParams,
  BACKTEST_ENGINE_VERSION,
  type BacktestRunParams,
} from '@polywatch/backtest';
import { requireJwt } from '../middleware/auth.js';
import { parseLimit, parseOffset } from './lib/query-params.js';
import { toRunDto } from './lib/backtest-dto.js';
import { computeConfigFingerprint } from './lib/config-fingerprint.js';
import { backtestRunTracker } from './lib/backtest-run-tracker.js';
import pino from 'pino';

const log = pino({ name: 'backend:backtest' });

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
  const tracker = backtestRunTracker;

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

    // Le filtre fidelityMinutes n'est applicable qu'en mode reevaluate :
    // weather_evaluation_log (source des signaux replay) ne porte pas de
    // colonne fidelity_minutes. Bloquer replay+fidelityMinutes pour éviter
    // des runs incohérents (signaux denses vs ticks filtrés).
    if (params.mode === 'replay' && params.fidelityMinutes != null) {
      res.status(400).json({
        error: 'replay_fidelity_filter_unsupported',
        detail: 'fidelityMinutes non applicable en mode replay (weather_evaluation_log ne porte pas fidelity_minutes)',
      });
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

    tracker.track(run.id);

    void (async () => {
      try {
        await runBacktest({
          runId: run.id,
          ds,
          params,
          configSnapshot: config,
          service,
          getAbortReason: () => tracker.getAbortReason(run.id),
        });
      } catch (err) {
        log.error({ runId: run.id, err }, 'backtest run failed');
        await service.markFailed(run.id, (err as Error).message ?? String(err));
      } finally {
        tracker.release(run.id);
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
      tracker.cancel(id);
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
    tracker.release(id);
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

  // ── Live market price series (ridge plot, toutes les données marché) ──
  // Renvoie les séries de prix YES agrégées depuis weather_bucket_ticks sur
  // toute la plage disponible en base (MIN→MAX recordedAt), indépendamment de
  // toute run. Même pattern d'agrégation que l'endpoint par run (SELECT
  // DISTINCT markets puis ticks par batch de 200).
  router.get('/markets-series', requireJwt, async (req, res) => {
    const fidelityMinutesRaw = Number(req.query.fidelityMinutes);
    const fidelityMinutes =
      Number.isFinite(fidelityMinutesRaw) && fidelityMinutesRaw > 0
        ? Math.floor(fidelityMinutesRaw)
        : undefined;

    // 0. Plage réelle = [MIN, MAX] des ticks en base (avec filtre fid si présent).
    const rangeQb = ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .select('MIN(t.recordedAt)', 'minT')
      .addSelect('MAX(t.recordedAt)', 'maxT');
    if (fidelityMinutes != null) {
      rangeQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
    }
    const range = await rangeQb.getRawOne<{ minT: Date | null; maxT: Date | null }>();
    const from = range?.minT ? new Date(range.minT) : null;
    const to = range?.maxT ? new Date(range.maxT) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.json({ items: [], truncated: false, window: { from: null, to: null } });
      return;
    }

    // 1. Marchés distincts sur la fenêtre.
    const marketQb = ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .select('t.conditionId', 'conditionId')
      .addSelect('t.city', 'city')
      .addSelect('t.targetDateIso', 'targetDateIso')
      .addSelect('t.metric', 'metric')
      .addSelect('t.bucketComparison', 'bucketComparison')
      .addSelect('t.bucketTarget', 'bucketTarget')
      .addSelect('t.bucketLow', 'bucketLow')
      .addSelect('t.bucketHigh', 'bucketHigh')
      .addSelect('t.question', 'question')
      .where('t.recordedAt >= :from', { from })
      .andWhere('t.recordedAt <= :to', { to })
      .groupBy('t.conditionId')
      .addGroupBy('t.city')
      .addGroupBy('t.targetDateIso')
      .addGroupBy('t.metric')
      .addGroupBy('t.bucketComparison')
      .addGroupBy('t.bucketTarget')
      .addGroupBy('t.bucketLow')
      .addGroupBy('t.bucketHigh')
      .addGroupBy('t.question')
      .orderBy('MIN(t.recordedAt)', 'ASC');
    if (fidelityMinutes != null) {
      marketQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
    }
    const markets = await marketQb.getRawMany<{
      conditionId: string;
      city: string | null;
      targetDateIso: string | null;
      metric: string | null;
      bucketComparison: string | null;
      bucketTarget: number | null;
      bucketLow: number | null;
      bucketHigh: number | null;
      question: string | null;
    }>();

    // 2. Ticks par batch de conditionId, triés par recorded_at.
    const BATCH = 200;
    const series = new Map<string, {
      conditionId: string;
      city: string | null;
      targetDateIso: string | null;
      metric: string | null;
      bucketComparison: string | null;
      bucketTarget: number | null;
      bucketLow: number | null;
      bucketHigh: number | null;
      unit: string | null;
      points: { t: string; yesPrice: number | null }[];
    }>();
    for (let i = 0; i < markets.length; i += BATCH) {
      const batch = markets.slice(i, i + BATCH).map((m) => m.conditionId);
      const tickQb = ds
        .getRepository(WeatherBucketTick)
        .createQueryBuilder('t')
        .select('t.conditionId', 'conditionId')
        .addSelect('t.recordedAt', 'recordedAt')
        .addSelect('t.yesPrice', 'yesPrice')
        .where('t.conditionId IN (:...ids)', { ids: batch })
        .andWhere('t.recordedAt >= :from', { from })
        .andWhere('t.recordedAt <= :to', { to })
        .orderBy('t.recordedAt', 'ASC')
        .addOrderBy('t.id', 'ASC');
      if (fidelityMinutes != null) {
        tickQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
      }
      const ticks = await tickQb.getRawMany<{
        conditionId: string;
        recordedAt: Date;
        yesPrice: number | null;
      }>();
      for (const t of ticks) {
        let entry = series.get(t.conditionId);
        if (!entry) {
          const meta = markets.find((m) => m.conditionId === t.conditionId);
          entry = {
            conditionId: t.conditionId,
            city: meta?.city ?? null,
            targetDateIso: meta?.targetDateIso ?? null,
            metric: meta?.metric ?? null,
            bucketComparison: meta?.bucketComparison ?? null,
            bucketTarget: meta?.bucketTarget ?? null,
            bucketLow: meta?.bucketLow ?? null,
            bucketHigh: meta?.bucketHigh ?? null,
            unit: meta?.question ? (parseWeatherQuestion(meta.question)?.unit ?? null) : null,
            points: [],
          };
          series.set(t.conditionId, entry);
        }
        entry.points.push({ t: new Date(t.recordedAt).toISOString(), yesPrice: t.yesPrice });
      }
    }

    res.json({
      items: [...series.values()],
      truncated: false,
      window: { from: from.toISOString(), to: to.toISOString() },
    });
  });

  // ── Market price series traversed by a run (ridge plot) ────────────────
  // Dérive les séries de prix YES par marché (conditionId) depuis
  // weather_bucket_ticks sur la plage du run. On applique le même filtre
  // fidelityMinutes que le data-loader du moteur (data-loader.ts) : sans lui,
  // on remonterait des marchés à toutes les cadences, y compris ceux que le
  // moteur n'a pas réellement évalués.
  //
  // Deux requêtes bornées (pas de LIMIT global trompeur) :
  //   1. SELECT DISTINCT condition_id, city, target_date_iso (borné par la plage)
  //   2. ticks par batch de conditionId, triés par recorded_at, agrégés en code.
  router.get('/runs/:id/markets-series', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const params = safeParseJson(run.paramsJson) as Record<string, unknown> | null;
    const cities = Array.isArray(params?.cities)
      ? (params.cities as unknown[]).filter((c): c is string => typeof c === 'string')
      : null;
    const fidelityMinutesRaw = Number(params?.fidelityMinutes);
    const fidelityMinutes =
      Number.isFinite(fidelityMinutesRaw) && fidelityMinutesRaw > 0
        ? Math.floor(fidelityMinutesRaw)
        : undefined;

    // La période paramétrée de la run (params.from/to) définit l'étendue des
    // marchés à afficher, pas la plage effective des données consommées.
    const fromIso = typeof params?.from === 'string' ? params.from : null;
    const toIso = typeof params?.to === 'string' ? params.to : null;
    const from = fromIso ? new Date(fromIso) : null;
    const to = toIso ? new Date(toIso) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.json({ items: [], truncated: false });
      return;
    }

    // 1. Marchés distincts sur la plage (borné par la plage + filtres).
    const marketQb = ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .select('t.conditionId', 'conditionId')
      .addSelect('t.city', 'city')
      .addSelect('t.targetDateIso', 'targetDateIso')
      .addSelect('t.metric', 'metric')
      .addSelect('t.bucketComparison', 'bucketComparison')
      .addSelect('t.bucketTarget', 'bucketTarget')
      .addSelect('t.bucketLow', 'bucketLow')
      .addSelect('t.bucketHigh', 'bucketHigh')
      .addSelect('t.question', 'question')
      .where('t.recordedAt >= :from', { from })
      .andWhere('t.recordedAt <= :to', { to })
      .groupBy('t.conditionId')
      .addGroupBy('t.city')
      .addGroupBy('t.targetDateIso')
      .addGroupBy('t.metric')
      .addGroupBy('t.bucketComparison')
      .addGroupBy('t.bucketTarget')
      .addGroupBy('t.bucketLow')
      .addGroupBy('t.bucketHigh')
      .addGroupBy('t.question')
      .orderBy('MIN(t.recordedAt)', 'ASC');
    if (fidelityMinutes != null) {
      marketQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
    }
    if (cities && cities.length > 0) {
      marketQb.andWhere('LOWER(t.city) IN (:...cities)', {
        cities: cities.map((c) => c.toLowerCase()),
      });
    }
    const markets = await marketQb.getRawMany<{
      conditionId: string;
      city: string | null;
      targetDateIso: string | null;
      metric: string | null;
      bucketComparison: string | null;
      bucketTarget: number | null;
      bucketLow: number | null;
      bucketHigh: number | null;
      question: string | null;
    }>();

    // 2. Ticks par batch de conditionId, triés par recorded_at.
    const BATCH = 200;
    const series = new Map<string, {
      conditionId: string;
      city: string | null;
      targetDateIso: string | null;
      metric: string | null;
      bucketComparison: string | null;
      bucketTarget: number | null;
      bucketLow: number | null;
      bucketHigh: number | null;
      unit: string | null;
      points: { t: string; yesPrice: number | null }[];
    }>();
    for (let i = 0; i < markets.length; i += BATCH) {
      const batch = markets.slice(i, i + BATCH).map((m) => m.conditionId);
      const tickQb = ds
        .getRepository(WeatherBucketTick)
        .createQueryBuilder('t')
        .select('t.conditionId', 'conditionId')
        .addSelect('t.recordedAt', 'recordedAt')
        .addSelect('t.yesPrice', 'yesPrice')
        .where('t.conditionId IN (:...ids)', { ids: batch })
        .andWhere('t.recordedAt >= :from', { from })
        .andWhere('t.recordedAt <= :to', { to })
        .orderBy('t.recordedAt', 'ASC')
        .addOrderBy('t.id', 'ASC');
      if (fidelityMinutes != null) {
        tickQb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
      }
      const ticks = await tickQb.getRawMany<{
        conditionId: string;
        recordedAt: Date;
        yesPrice: number | null;
      }>();
      for (const t of ticks) {
        let entry = series.get(t.conditionId);
        if (!entry) {
          const meta = markets.find((m) => m.conditionId === t.conditionId);
          entry = {
            conditionId: t.conditionId,
            city: meta?.city ?? null,
            targetDateIso: meta?.targetDateIso ?? null,
            metric: meta?.metric ?? null,
            bucketComparison: meta?.bucketComparison ?? null,
            bucketTarget: meta?.bucketTarget ?? null,
            bucketLow: meta?.bucketLow ?? null,
            bucketHigh: meta?.bucketHigh ?? null,
            unit: meta?.question ? (parseWeatherQuestion(meta.question)?.unit ?? null) : null,
            points: [],
          };
          series.set(t.conditionId, entry);
        }
        entry.points.push({ t: new Date(t.recordedAt).toISOString(), yesPrice: t.yesPrice });
      }
    }

    res.json({
      items: [...series.values()],
      truncated: false,
    });
  });

  return router;
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Orphan recovery: mark runs stuck in running/queued as failed on boot. */
export async function recoverOrphanedBacktestRuns(ds: DataSource): Promise<void> {
  await new BacktestRunService(ds).markOrphanedRunningAsFailed();
}

/** Best-effort cancel of all in-flight runs (graceful shutdown). */
export function cancelAllActiveBacktestRuns(): void {
  backtestRunTracker.cancelAll();
}
