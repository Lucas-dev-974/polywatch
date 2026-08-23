import { Router } from 'express';
import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { QueryFailedError } from 'typeorm';
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
import { requireJwt, type AuthRequest } from '../middleware/auth.js';
import { parseLimit, parseOffset, parseMinAvgYes } from './lib/query-params.js';
import { toRunDto } from './lib/backtest-dto.js';
import { computeConfigFingerprint } from './lib/config-fingerprint.js';
import { backtestRunTracker } from './lib/backtest-run-tracker.js';
import pino from 'pino';

const log = pino({ name: 'backend:backtest' });

// Borne sur le nombre de marchés séries retournés par /markets-series et
// /runs/:id/markets-series (ridge plot). Les marchés au-delà sont tronqués
// et signalés par `truncated: true` pour éviter des réponses JSON démesurées.
const MAX_MARKETS_SERIES = Number(process.env.BACKTEST_MARKETS_SERIES_LIMIT ?? 500);

// Cache court-terme pour les agrégats /markets-series et /runs/:id/markets-series.
// La plage [MIN,MAX] et la liste des marchés distincts sont stables sur une
// fenêtre courte (les ticks sont ingérés par batch). Le ridge live est pollé
// toutes les ~10 s côté frontend ; avec un TTL de 30 s on ne refait la requête
// coûteuse (DISTINCT + GROUP BY) qu'environ une fois sur trois.
const MARKETS_SERIES_TTL_MS = 30_000;
const marketsSeriesCache = new Map<string, { at: number; value: unknown }>();

async function cachedMarketsSeries<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = marketsSeriesCache.get(key);
  if (hit && hit.at > Date.now()) return hit.value as T;
  const value = await load();
  marketsSeriesCache.set(key, { at: Date.now() + MARKETS_SERIES_TTL_MS, value });
  // Garde-fou mémoire : purge des entrées expirées si le cache grossit.
  if (marketsSeriesCache.size > 32) {
    const now = Date.now();
    for (const [k, e] of marketsSeriesCache) {
      if (e.at < now) marketsSeriesCache.delete(k);
    }
  }
  return value;
}

interface MarketRow {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  metric: string | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  question: string | null;
  snapshotId: number | null;
}

/**
 * Construit la requête des marchés distincts sur une fenêtre [from,to],
 * avec filtres fidelityMinutes/cities optionnels. Le QueryBuilder retourné
 * peut être rejoué pour la pagination (page + count) sans dupliquer la logique
 * entre /markets-series et /runs/:id/markets-series.
 */
function buildMarketsQuery(
  ds: DataSource,
  opts: {
    from: Date;
    to: Date;
    fidelityMinutes?: number;
    cities?: string[] | null;
    minAvgYes?: number;
  },
): SelectQueryBuilder<WeatherBucketTick> {
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
    .addSelect('MAX(s.id)', 'snapshotId')
    .leftJoin(WeatherMarketSnapshot, 's', 's.id = t.snapshotId')
    .where('t.recordedAt >= :from', { from: opts.from })
    .andWhere('t.recordedAt <= :to', { to: opts.to })
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
  if (opts.fidelityMinutes != null) {
    marketQb.andWhere('t.fidelityMinutes = :fid', { fid: opts.fidelityMinutes });
  }
  if (opts.cities && opts.cities.length > 0) {
    marketQb.andWhere('LOWER(t.city) IN (:...cities)', {
      cities: opts.cities.map((c) => c.toLowerCase()),
    });
  }
  // Filtre prix YES moyen (0..1) : ne garde que les marchés dont le prix moyen
  // dépasse le seuil. Appliqué en HAVING (le AVG porte sur le groupBy conditionId).
  // Réduit drastiquement le payload du ridge plot (ex. 1100 → 191 marchés).
  if (opts.minAvgYes != null && opts.minAvgYes > 0) {
    marketQb.having('AVG(t.yesPrice) > :minAvgYes', { minAvgYes: opts.minAvgYes });
  }
  return marketQb;
}

/** Compte les marchés distincts d'une fenêtre (pour la pagination). */
async function countMarketWindow(
  ds: DataSource,
  opts: {
    from: Date;
    to: Date;
    fidelityMinutes?: number;
    cities?: string[] | null;
    minAvgYes?: number;
  },
): Promise<number> {
  // ⚠️ Ne PAS utiliser qb.getCount() ici : TypeORM vide le GROUP BY mais garde
  // le HAVING dans executeCountQuery, produisant un `SELECT COUNT(...) ... HAVING AVG(...)`
  // sans GROUP BY. PostgreSQL agrège alors toute la table en une seule ligne et
  // le total renvoyé est faux (1 ou 0). On compte donc sur une sous-requête
  // qui préserve le GROUP BY + HAVING (une ligne par marché).
  const sub = ds
    .getRepository(WeatherBucketTick)
    .createQueryBuilder('t')
    .select('t.conditionId', 'conditionId')
    .where('t.recordedAt >= :from', { from: opts.from })
    .andWhere('t.recordedAt <= :to', { to: opts.to });
  if (opts.fidelityMinutes != null) {
    sub.andWhere('t.fidelityMinutes = :fid', { fid: opts.fidelityMinutes });
  }
  if (opts.cities && opts.cities.length > 0) {
    sub.andWhere('LOWER(t.city) IN (:...cities)', {
      cities: opts.cities.map((c) => c.toLowerCase()),
    });
  }
  sub.groupBy('t.conditionId');
  if (opts.minAvgYes != null && opts.minAvgYes > 0) {
    sub.having('AVG(t.yesPrice) > :minAvgYes', { minAvgYes: opts.minAvgYes });
  }
  const row = await ds
    .createQueryBuilder()
    .select('COUNT(*)', 'cnt')
    .from(`(${sub.getQuery()})`, 'sub')
    .setParameters(sub.getParameters())
    .getRawOne<{ cnt: string | number }>();
  return row ? Number(row.cnt) : 0;
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
  router.post('/runs', requireJwt, async (req: AuthRequest, res) => {
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

    // Singleton lock per user: no concurrent run for the same domain.
    // Fast-path check for a clear error; the unique DB index is the source of
    // truth against TOCTOU races (see catch below).
    const userId = req.user!.userId;
    const active = await service.hasActiveRun('weather', userId);
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
      userId,
    }).catch((err: unknown) => {
      // Violation de l'index unique backtest_run_active_unique → run déjà actif.
      if (err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23505') {
        return null;
      }
      throw err;
    });
    if (!run) {
      const activeAfter = await service.hasActiveRun('weather', userId);
      res.status(409).json({
        error: 'run_already_active',
        runId: activeAfter?.id ?? null,
      });
      return;
    }

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
  router.get('/runs', requireJwt, async (req: AuthRequest, res) => {
    const limit = parseLimit(req.query.limit, 50, 100);
    const offset = parseOffset(req.query.offset);
    const domain = typeof req.query.domain === 'string' ? req.query.domain : 'weather';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const { items, total } = await service.list({
      domain: domain as 'weather',
      status: status as BacktestRun['status'] | undefined,
      limit,
      offset,
      userId: req.user!.userId,
    });
    res.json({ items: items.map(toRunDto), total });
  });

  // ── Get a single run ───────────────────────────────────────────────────
  router.get('/runs/:id', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const run = await service.getById(id, req.user!.userId);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toRunDto(run));
  });

  // ── Cancel a run ───────────────────────────────────────────────────────
  router.post('/runs/:id/cancel', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
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
  router.delete('/runs/:id', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
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
  router.get('/runs/:id/positions', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
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
  router.get('/runs/:id/equity', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
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

  // ── Excluded ticks of a run (tracés orange) ──────────────────────────
  router.get('/runs/:id/excluded-ticks', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const ticks = await service.listExcludedTicks(id);
    res.json({
      ticks: ticks.map((t) => ({
        t: t.t.toISOString(),
        reason: t.reason,
        city: t.city,
        conditionId: t.conditionId,
        metric: t.metric,
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
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, MAX_MARKETS_SERIES, MAX_MARKETS_SERIES);
    const minAvgYes = parseMinAvgYes(req.query.minAvgYes);

    const cacheKey = `live:${fidelityMinutes ?? 'all'}:${minAvgYes ?? 'all'}`;
    // Fenêtre [MIN,MAX] + total = stables sur le TTL → cacheables. La page des
    // marchés est ensuite lue en LIMIT/OFFSET SQL (léger), pas un full-scan.
    const { from, to, total } = await cachedMarketsSeries<{
      from: Date | null;
      to: Date | null;
      total: number;
    }>(cacheKey, async () => {
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
        return { from: null, to: null, total: 0 };
      }
      const total = await countMarketWindow(ds, { from, to, fidelityMinutes, minAvgYes: minAvgYes ?? undefined });
      return { from, to, total };
    });

    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.json({ items: [], total: 0, truncated: false, window: { from: null, to: null } });
      return;
    }

    // Pagination DB : on ne charge que la page demandée (pas le full-scan).
    const marketQb = buildMarketsQuery(ds, { from, to, fidelityMinutes, minAvgYes: minAvgYes ?? undefined })
      .skip(offset)
      .take(limit);
    const markets = await marketQb.getRawMany<MarketRow>();
    const truncated = total > offset + limit;

    // Résolution de la prévision : on récupère forecast_mean / forecast_std_dev
    // du snapshot le plus récent de chaque marché de la page affichée en une
    // seule requête (borné par la page, pas par la fenêtre complète).
    const snapshotIds = [...new Set(markets.map((m) => m.snapshotId).filter((id): id is number => id != null))];
    const forecastBySnapshot = new Map<number, { forecastMean: number | null; forecastStdDev: number | null }>();
    if (snapshotIds.length > 0) {
      const snapRows = await ds
        .getRepository(WeatherMarketSnapshot)
        .createQueryBuilder('s')
        .select('s.id', 'id')
        .addSelect('s.forecastMean', 'forecastMean')
        .addSelect('s.forecastStdDev', 'forecastStdDev')
        .where('s.id IN (:...ids)', { ids: snapshotIds })
        .getRawMany<{ id: number; forecastMean: number | null; forecastStdDev: number | null }>();
      for (const r of snapRows) {
        forecastBySnapshot.set(r.id, { forecastMean: r.forecastMean, forecastStdDev: r.forecastStdDev });
      }
    }

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
      forecastMean: number | null;
      forecastStdDev: number | null;
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
          const forecast = meta?.snapshotId != null
            ? forecastBySnapshot.get(meta.snapshotId)
            : undefined;
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
            forecastMean: forecast?.forecastMean ?? null,
            forecastStdDev: forecast?.forecastStdDev ?? null,
            points: [],
          };
          series.set(t.conditionId, entry);
        }
        entry.points.push({ t: new Date(t.recordedAt).toISOString(), yesPrice: t.yesPrice });
      }
    }

    res.json({
      items: [...series.values()],
      total,
      truncated,
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
  router.get('/runs/:id/markets-series', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const run = await service.getById(id, req.user!.userId);
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
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit, MAX_MARKETS_SERIES, MAX_MARKETS_SERIES);
    const minAvgYes = parseMinAvgYes(req.query.minAvgYes);

    // La période paramétrée de la run (params.from/to) définit l'étendue des
    // marchés à afficher, pas la plage effective des données consommées.
    const fromIso = typeof params?.from === 'string' ? params.from : null;
    const toIso = typeof params?.to === 'string' ? params.to : null;
    const from = fromIso ? new Date(fromIso) : null;
    const to = toIso ? new Date(toIso) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.json({ items: [], truncated: false, total: 0 });
      return;
    }

    const cacheKey = `run:${id}:${from.toISOString()}:${to.toISOString()}:${fidelityMinutes ?? 'all'}:${(cities ?? []).join(',')}:${minAvgYes ?? 'all'}`;
    const total = await cachedMarketsSeries<number>(cacheKey, async () => {
      const total = await countMarketWindow(ds, { from, to, fidelityMinutes, cities, minAvgYes: minAvgYes ?? undefined });
      return total;
    });

    // Pagination DB : on ne charge que la page demandée (pas le full-scan).
    const marketQb = buildMarketsQuery(ds, { from, to, fidelityMinutes, cities, minAvgYes: minAvgYes ?? undefined })
      .skip(offset)
      .take(limit);
    const markets = await marketQb.getRawMany<MarketRow>();
    const truncated = total > offset + limit;

    // Résolution de la prévision en une seule requête sur les snapshots de la
    // page affichée (borné par la page, pas par la fenêtre complète).
    const snapshotIds = [...new Set(markets.map((m) => m.snapshotId).filter((id): id is number => id != null))];
    const forecastBySnapshot = new Map<number, { forecastMean: number | null; forecastStdDev: number | null }>();
    if (snapshotIds.length > 0) {
      const snapRows = await ds
        .getRepository(WeatherMarketSnapshot)
        .createQueryBuilder('s')
        .select('s.id', 'id')
        .addSelect('s.forecastMean', 'forecastMean')
        .addSelect('s.forecastStdDev', 'forecastStdDev')
        .where('s.id IN (:...ids)', { ids: snapshotIds })
        .getRawMany<{ id: number; forecastMean: number | null; forecastStdDev: number | null }>();
      for (const r of snapRows) {
        forecastBySnapshot.set(r.id, { forecastMean: r.forecastMean, forecastStdDev: r.forecastStdDev });
      }
    }

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
      forecastMean: number | null;
      forecastStdDev: number | null;
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
          const forecast = meta?.snapshotId != null
            ? forecastBySnapshot.get(meta.snapshotId)
            : undefined;
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
            forecastMean: forecast?.forecastMean ?? null,
            forecastStdDev: forecast?.forecastStdDev ?? null,
            points: [],
          };
          series.set(t.conditionId, entry);
        }
        entry.points.push({ t: new Date(t.recordedAt).toISOString(), yesPrice: t.yesPrice });
      }
    }

    res.json({
      items: [...series.values()],
      total,
      truncated,
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
