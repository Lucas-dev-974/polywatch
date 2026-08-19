import type { DataSource } from 'typeorm';
import {
  WeatherBucketTick,
  WeatherMarketSnapshot,
  WeatherForecastHistory,
  WeatherEvaluationLog,
} from '@polywatch/core';
import type { BacktestEvent } from '../../engine/events.js';
import type { BacktestRunParams } from '../../params.js';
import { mergeEventStreams } from '../../engine/merge-event-streams.js';

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
  if (params.mode === 'replay') {
    // Le filtre fidelity ne s'applique pas aux signals : weather_evaluation_log
    // ne porte pas de colonne fidelity_minutes (limite documentée — warning
    // émis par l'adapter en mode replay).
    streams.push(loadSignalEvents(ds, from, to, cities, params.strategyId));
  }

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
  if (params.mode === 'replay') {
    total += await countSignalEvents(ds, from, to, cities, params.strategyId);
  }
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

async function countSignalEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
  strategyId: string,
): Promise<number> {
  const qb = ds
    .getRepository(WeatherEvaluationLog)
    .createQueryBuilder('e')
    .leftJoin(WeatherMarketSnapshot, 's', 's.id = e.snapshotId')
    .where('e.evaluatedAt >= :from', { from })
    .andWhere('e.evaluatedAt <= :to', { to })
    .andWhere("e.decision = 'signal'")
    .andWhere('e.strategyId = :strategyId', { strategyId });
  applyCityFilter(qb, 's', 'city', cities);
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

async function* loadSignalEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
  strategyId: string,
): AsyncGenerator<BacktestEvent> {
  yield* paginateKeyset(
    (cursor) => {
      const qb = ds
        .getRepository(WeatherEvaluationLog)
        .createQueryBuilder('e')
        .leftJoin(WeatherMarketSnapshot, 's', 's.id = e.snapshotId')
        .select([
          'e.id',
          'e.conditionId',
          'e.strategyId',
          'e.yesPrice',
          'e.forecastProb',
          'e.edge',
          'e.dynamicMinEdge',
          'e.decision',
          'e.bucketComparison',
          'e.bucketTarget',
          'e.bucketLow',
          'e.bucketHigh',
          'e.evaluatedAt',
          's.city',
          's.forecastMean',
          's.targetDateIso',
          's.metric',
        ])
        .where('e.evaluatedAt >= :from', { from })
        .andWhere('e.evaluatedAt <= :to', { to })
        .andWhere("e.decision = 'signal'")
        .andWhere('e.strategyId = :strategyId', { strategyId })
        .orderBy('e.evaluatedAt', 'ASC')
        .addOrderBy('e.id', 'ASC')
        .limit(5000);
      applyTimeIdCursor(qb, 'e', 'evaluatedAt', cursor);
      applyCityFilter(qb, 's', 'city', cities);
      return qb;
    },
    (row) => ({
      kind: 'signal',
      at: new Date(row.e_evaluated_at),
      data: {
        conditionId: row.e_condition_id,
        strategyId: row.e_strategy_id,
        yesPrice: row.e_yes_price,
        forecastProb: row.e_forecast_prob,
        edge: row.e_edge,
        dynamicMinEdge: row.e_dynamic_min_edge,
        decision: row.e_decision,
        bucketComparison: row.e_bucket_comparison,
        bucketTarget: row.e_bucket_target,
        bucketLow: row.e_bucket_low,
        bucketHigh: row.e_bucket_high,
        city: row.s_city ?? null,
        snapshotForecastMean: row.s_forecast_mean ?? null,
        snapshotTargetDateIso: row.s_target_date_iso ?? null,
        snapshotMetric: row.s_metric ?? null,
      },
    }),
    'e_evaluated_at',
    'e_id',
  );
}
