import type { DataSource } from 'typeorm';
import {
  WeatherBucketTick,
  WeatherMarketSnapshot,
  WeatherForecastHistory,
} from '@polywatch/core';
import type { BacktestEvent } from '../../engine/events.js';
import type { BacktestRunParams } from '../../params.js';
import { mergeEventStreams } from '../../engine/merge-event-streams.js';

/**
 * Statistiques quantitatives de fidélité (§12.2 du plan market-data-persistence).
 * Calculées depuis les tables persistées pour alerter sur les approximations
 * de replay (buckets inactifs exclus, prix null, gaps temporels, révisions).
 */
export interface WeatherFidelityStats {
  /** Σ (total_bucket_count - bucket_count) — buckets inactifs non enregistrés. */
  inactiveBucketsExcluded: number;
  /** Nombre de bucket_ticks avec yes_price null. */
  yesPriceNulls: number;
  /** Nombre de bucket_ticks avec no_price null. */
  noPriceNulls: number;
  /** Nombre total de révisions forecast dans la plage. */
  forecastRevisions: number;
  /** Révisions forecast par jour (moyenne). */
  forecastRevisionsPerDay: number;
  /** Nombre total de snapshots dans la plage. */
  snapshots: number;
  /** Snapshots par jour (moyenne). */
  snapshotsPerDay: number;
  /** Ville/date avec forecast mais sans snapshot (gaps temporels). */
  missingSnapshots: number;
  /** Snapshots dont des buckets inactifs ont été exclus (Σ yesPrice incomplet). */
  incompleteCityDates: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule les statistiques de fidélité sur la plage demandée. Best-effort :
 * une erreur de requête retourne des zéros (le run continue, warning émis par
 * l'adapter si les stats sont indisponibles).
 */
export async function computeWeatherFidelityStats(
  ds: DataSource,
  params: BacktestRunParams,
): Promise<WeatherFidelityStats> {
  const from = new Date(params.from);
  const to = new Date(params.to);
  const cities = params.cities?.length ? params.cities : null;
  const cityFilter = (alias: string, column: string) =>
    cities
      ? `LOWER(${alias}.${column}) IN (:...cities)`
      : undefined;
  const cityParams = cities ? { cities: cities.map((c) => c.toLowerCase()) } : {};

  const snapRepo = ds.getRepository(WeatherMarketSnapshot);
  const tickRepo = ds.getRepository(WeatherBucketTick);
  const histRepo = ds.getRepository(WeatherForecastHistory);

  const snapQb = snapRepo
    .createQueryBuilder('s')
    .where('s.recordedAt >= :from', { from })
    .andWhere('s.recordedAt <= :to', { to });
  const snapCityCond = cityFilter('s', 'cityNormalized');
  if (snapCityCond) snapQb.andWhere(snapCityCond, cityParams);
  const snapshots = await snapQb.getMany();

  const tickQb = tickRepo
    .createQueryBuilder('t')
    .where('t.recordedAt >= :from', { from })
    .andWhere('t.recordedAt <= :to', { to });
  const tickCityCond = cityFilter('t', 'cityNormalized');
  if (tickCityCond) tickQb.andWhere(tickCityCond, cityParams);
  const ticks = await tickQb.getMany();

  const histQb = histRepo
    .createQueryBuilder('f')
    .where('f.fetchedAt >= :from', { from })
    .andWhere('f.fetchedAt <= :to', { to });
  const histCityCond = cityFilter('f', 'city');
  if (histCityCond) histQb.andWhere(histCityCond, cityParams);
  const histories = await histQb.getMany();

  const inactiveBucketsExcluded = snapshots.reduce(
    (acc, s) => acc + Math.max(0, s.totalBucketCount - s.bucketCount),
    0,
  );
  const incompleteCityDates = snapshots.filter((s) => s.totalBucketCount > s.bucketCount).length;
  const yesPriceNulls = ticks.filter((t) => t.yesPrice == null).length;
  const noPriceNulls = ticks.filter((t) => t.noPrice == null).length;

  const snapDays = new Set(snapshots.map((s) => dayKey(s.recordedAt))).size;
  const histDays = new Set(histories.map((h) => dayKey(h.fetchedAt))).size;
  const snapshotsPerDay = snapDays > 0 ? snapshots.length / snapDays : 0;
  const forecastRevisionsPerDay = histDays > 0 ? histories.length / histDays : 0;

  const snapCityDates = new Set(
    snapshots.map((s) => `${s.cityNormalized.trim().toLowerCase()}|${s.targetDateIso}`),
  );
  const histCityDates = new Set(
    histories.map((h) => `${h.city.trim().toLowerCase()}|${dayKey(h.forecastDate)}`),
  );
  let missingSnapshots = 0;
  for (const key of histCityDates) {
    if (!snapCityDates.has(key)) missingSnapshots += 1;
  }

  return {
    inactiveBucketsExcluded,
    yesPriceNulls,
    noPriceNulls,
    forecastRevisions: histories.length,
    forecastRevisionsPerDay,
    snapshots: snapshots.length,
    snapshotsPerDay,
    missingSnapshots,
    incompleteCityDates,
  };
}

/**
 * Loads weather backtest events from PostgreSQL as merged async streams.
 * Each source paginates in (timestamp, id) order so the k-way merge receives
 * monotonically increasing `event.at` values (required by VirtualClock).
 */
export async function* loadWeatherEvents(
  ds: DataSource,
  params: BacktestRunParams,
): AsyncGenerator<BacktestEvent> {
  const from = new Date(params.from);
  const to = new Date(params.to);
  const cities = params.cities?.length ? params.cities : null;
  const fidelityMinutes = params.fidelityMinutes;

  const streams: AsyncIterable<BacktestEvent>[] = [
    loadForecastEvents(ds, from, to, cities),
    loadTickEvents(ds, from, to, cities, fidelityMinutes),
  ];

  yield* mergeEventStreams(streams);
}

/** Pre-count events for progress estimation (does not load event payloads). */
export async function countWeatherEvents(
  ds: DataSource,
  params: BacktestRunParams,
): Promise<number> {
  const from = new Date(params.from);
  const to = new Date(params.to);
  const cities = params.cities?.length ? params.cities : null;
  const fidelityMinutes = params.fidelityMinutes;

  let total = await countForecastEvents(ds, from, to, cities);
  total += await countTickEvents(ds, from, to, cities, fidelityMinutes);
  return total;
}

// ── Helpers de pagination keyset et de filtres ─────────────────────────────

type TimeIdCursor = { at: Date; id: number };

/** Type minimal de query builder utilisé par la pagination keyset. */
interface KeysetQueryBuilder {
  andWhere(where: string, params?: Record<string, unknown>): this;
  getRawMany(): Promise<any[]>;
}

/**
 * Keyset pagination must follow the same key as the merge (`event.at`).
 * Ordering only by id is unsafe: inserts can interleave so a higher id has an
 * earlier timestamp, which then regresses the VirtualClock.
 */
function applyTimeIdCursor(
  qb: KeysetQueryBuilder,
  alias: string,
  timeColumn: string,
  cursor: TimeIdCursor | null,
): void {
  if (!cursor) return;
  qb.andWhere(
    `(${alias}.${timeColumn} > :lastAt OR (${alias}.${timeColumn} = :lastAt AND ${alias}.id > :lastId))`,
    { lastAt: cursor.at, lastId: cursor.id },
  );
}

function nextTimeIdCursor(
  rows: Array<Record<string, any>>,
  timeKey: string,
  idKey: string,
): TimeIdCursor {
  const last = rows[rows.length - 1]!;
  const id = last[idKey];
  return {
    at: new Date(last[timeKey] as string | Date),
    id: typeof id === 'number' ? id : Number(id ?? 0),
  };
}

/** Applique le filtre villes (insensible à la casse) si une liste est fournie. */
function applyCityFilter(
  qb: { andWhere(where: string, params?: Record<string, unknown>): unknown },
  alias: string,
  column: string,
  cities: string[] | null,
): void {
  if (cities) {
    qb.andWhere(`LOWER(${alias}.${column}) IN (:...cities)`, {
      cities: cities.map((c) => c.toLowerCase()),
    });
  }
}

/**
 * Boucle de pagination keyset générique : construit chaque page via
 * `buildQuery(cursor)`, mappe les lignes via `mapRow`, et itère jusqu'à
 * épuisement. Le query builder doit déjà porter where/orderBy/limit.
 */
async function* paginateKeyset<T, QB extends KeysetQueryBuilder>(
  buildQuery: (cursor: TimeIdCursor | null) => QB,
  mapRow: (row: Record<string, any>) => T,
  timeKey: string,
  idKey: string,
  chunk = 5000,
): AsyncGenerator<T> {
  let cursor: TimeIdCursor | null = null;
  for (;;) {
    const qb = buildQuery(cursor);
    const rows = await qb.getRawMany();
    if (rows.length === 0) break;
    for (const row of rows) yield mapRow(row);
    cursor = nextTimeIdCursor(rows, timeKey, idKey);
    if (rows.length < chunk) break;
  }
}

// ── Comptage (progress estimation) ────────────────────────────────────────

async function countForecastEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
): Promise<number> {
  const qb = ds
    .getRepository(WeatherForecastHistory)
    .createQueryBuilder('f')
    .where('f.fetchedAt >= :from', { from })
    .andWhere('f.fetchedAt <= :to', { to });
  applyCityFilter(qb, 'f', 'city', cities);
  return qb.getCount();
}

async function countTickEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
  fidelityMinutes?: number,
): Promise<number> {
  const qb = ds
    .getRepository(WeatherBucketTick)
    .createQueryBuilder('t')
    .where('t.recordedAt >= :from', { from })
    .andWhere('t.recordedAt <= :to', { to });
  if (fidelityMinutes != null) {
    qb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
  }
  applyCityFilter(qb, 't', 'city', cities);
  return qb.getCount();
}

// ── Loaders (streams d'événements) ───────────────────────────────────────

async function* loadForecastEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
): AsyncGenerator<BacktestEvent> {
  yield* paginateKeyset(
    (cursor) => {
      const qb = ds
        .getRepository(WeatherForecastHistory)
        .createQueryBuilder('f')
        .select([
          'f.id',
          'f.city',
          'f.forecastDate',
          'f.metric',
          'f.forecastMean',
          'f.forecastStdDev',
          'f.fetchedAt',
        ])
        .where('f.fetchedAt >= :from', { from })
        .andWhere('f.fetchedAt <= :to', { to })
        .orderBy('f.fetchedAt', 'ASC')
        .addOrderBy('f.id', 'ASC')
        .limit(5000);
      applyTimeIdCursor(qb, 'f', 'fetchedAt', cursor);
      applyCityFilter(qb, 'f', 'city', cities);
      return qb;
    },
    (row) => ({
      kind: 'forecast',
      at: new Date(row.f_fetched_at),
      data: {
        city: row.f_city,
        forecastDate: new Date(row.f_forecast_date),
        metric: row.f_metric,
        forecastMean: row.f_forecast_mean,
        forecastStdDev: row.f_forecast_std_dev,
        fetchedAt: new Date(row.f_fetched_at),
      },
    }),
    'f_fetched_at',
    'f_id',
  );
}

async function* loadTickEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
  fidelityMinutes?: number,
): AsyncGenerator<BacktestEvent> {
  yield* paginateKeyset(
    (cursor) => {
      const qb = ds
        .getRepository(WeatherBucketTick)
        .createQueryBuilder('t')
        .leftJoin(WeatherMarketSnapshot, 's', 's.id = t.snapshotId')
        .select([
          't.id',
          't.conditionId',
          't.eventSlug',
          't.question',
          't.bucketComparison',
          't.bucketTarget',
          't.bucketLow',
          't.bucketHigh',
          't.yesPrice',
          't.noPrice',
          't.volume',
          't.volume24hr',
          't.liquidityClob',
          't.acceptingOrders',
          't.closed',
          't.endDate',
          't.yesTokenId',
          't.recordedAt',
          't.city',
          't.targetDateIso',
          't.metric',
          's.forecastMean',
        ])
        .where('t.recordedAt >= :from', { from })
        .andWhere('t.recordedAt <= :to', { to })
        .orderBy('t.recordedAt', 'ASC')
        .addOrderBy('t.id', 'ASC')
        .limit(5000);
      applyTimeIdCursor(qb, 't', 'recordedAt', cursor);
      if (fidelityMinutes != null) {
        qb.andWhere('t.fidelityMinutes = :fid', { fid: fidelityMinutes });
      }
      applyCityFilter(qb, 't', 'city', cities);
      return qb;
    },
    (row) => {
      const endDate = row.t_end_date ? new Date(row.t_end_date) : null;
      return {
        kind: 'book_tick',
        at: new Date(row.t_recorded_at),
        data: {
          conditionId: row.t_condition_id,
          eventSlug: row.t_event_slug,
          question: row.t_question,
          bucketComparison: row.t_bucket_comparison,
          bucketTarget: row.t_bucket_target,
          bucketLow: row.t_bucket_low,
          bucketHigh: row.t_bucket_high,
          yesPrice: row.t_yes_price,
          noPrice: row.t_no_price,
          volume: row.t_volume,
          volume24hr: row.t_volume_24hr,
          liquidityClob: row.t_liquidity_clob,
          acceptingOrders: row.t_accepting_orders,
          closed: row.t_closed,
          endDate,
          tokenIdYes: row.t_yes_token_id,
          snapshotCity: row.t_city,
          snapshotTargetDateIso: row.t_target_date_iso,
          snapshotMetric: row.t_metric,
          snapshotForecastMean: row.s_forecast_mean,
        },
      };
    },
    't_recorded_at',
    't_id',
  );
}
