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

  const streams: AsyncIterable<BacktestEvent>[] = [
    loadForecastEvents(ds, from, to, cities),
    loadTickEvents(ds, from, to, cities),
  ];
  if (params.mode === 'replay') {
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

  let total = await countForecastEvents(ds, from, to, cities);
  total += await countTickEvents(ds, from, to, cities);
  if (params.mode === 'replay') {
    total += await countSignalEvents(ds, from, to, cities, params.strategyId);
  }
  return total;
}

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
  if (cities) {
    qb.andWhere('LOWER(f.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
  }
  return qb.getCount();
}

async function countTickEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
): Promise<number> {
  const qb = ds
    .getRepository(WeatherBucketTick)
    .createQueryBuilder('t')
    .where('t.recordedAt >= :from', { from })
    .andWhere('t.recordedAt <= :to', { to });
  if (cities) {
    qb.andWhere('LOWER(t.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
  }
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
  if (cities) {
    qb.andWhere('LOWER(s.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
  }
  return qb.getCount();
}

type TimeIdCursor = { at: Date; id: number };

/**
 * Keyset pagination must follow the same key as the merge (`event.at`).
 * Ordering only by id is unsafe: inserts can interleave so a higher id has an
 * earlier timestamp, which then regresses the VirtualClock.
 */
function applyTimeIdCursor(
  qb: {
    andWhere: (where: string, params?: Record<string, unknown>) => unknown;
  },
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
  rows: Array<Record<string, unknown>>,
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

async function* loadForecastEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
): AsyncGenerator<BacktestEvent> {
  const CHUNK = 5000;
  let cursor: TimeIdCursor | null = null;
  for (;;) {
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
      .limit(CHUNK);
    applyTimeIdCursor(qb, 'f', 'fetchedAt', cursor);
    if (cities) {
      qb.andWhere('LOWER(f.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
    }
    const rows = await qb.getRawMany();
    if (rows.length === 0) break;
    for (const row of rows) {
      yield {
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
      };
    }
    cursor = nextTimeIdCursor(rows, 'f_fetched_at', 'f_id');
    if (rows.length < CHUNK) break;
  }
}

async function* loadTickEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
): AsyncGenerator<BacktestEvent> {
  const CHUNK = 5000;
  let cursor: TimeIdCursor | null = null;
  for (;;) {
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
      .limit(CHUNK);
    applyTimeIdCursor(qb, 't', 'recordedAt', cursor);
    if (cities) {
      qb.andWhere('LOWER(t.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
    }
    const rows = await qb.getRawMany();
    if (rows.length === 0) break;
    for (const row of rows) {
      const endDate = row.t_end_date ? new Date(row.t_end_date) : null;
      yield {
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
    }
    cursor = nextTimeIdCursor(rows, 't_recorded_at', 't_id');
    if (rows.length < CHUNK) break;
  }
}

async function* loadSignalEvents(
  ds: DataSource,
  from: Date,
  to: Date,
  cities: string[] | null,
  strategyId: string,
): AsyncGenerator<BacktestEvent> {
  const CHUNK = 5000;
  let cursor: TimeIdCursor | null = null;
  for (;;) {
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
      ])
      .where('e.evaluatedAt >= :from', { from })
      .andWhere('e.evaluatedAt <= :to', { to })
      .andWhere("e.decision = 'signal'")
      .andWhere('e.strategyId = :strategyId', { strategyId })
      .orderBy('e.evaluatedAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .limit(CHUNK);
    applyTimeIdCursor(qb, 'e', 'evaluatedAt', cursor);
    if (cities) {
      qb.andWhere('LOWER(s.city) IN (:...cities)', { cities: cities.map((c) => c.toLowerCase()) });
    }
    const rows = await qb.getRawMany();
    if (rows.length === 0) break;
    for (const row of rows) {
      yield {
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
        },
      };
    }
    cursor = nextTimeIdCursor(rows, 'e_evaluated_at', 'e_id');
    if (rows.length < CHUNK) break;
  }
}
