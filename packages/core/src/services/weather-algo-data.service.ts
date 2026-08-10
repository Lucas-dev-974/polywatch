import pino from 'pino';
import type { DataSource } from 'typeorm';
import { WeatherForecastHistory } from '../entities/WeatherForecastHistory.js';
import { WeatherMarketSnapshot } from '../entities/WeatherMarketSnapshot.js';
import { WeatherBucketTick } from '../entities/WeatherBucketTick.js';
import { WeatherEvaluationLog } from '../entities/WeatherEvaluationLog.js';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';
import { WeatherClobPriceHistory } from '../entities/WeatherClobPriceHistory.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';

const log = pino({ name: 'core:weather-algo-data' });

export type WeatherAlgoDataTableId =
  | 'forecast_history'
  | 'market_snapshots'
  | 'bucket_ticks'
  | 'evaluation_log'
  | 'forecast_cache'
  | 'position_forecasts'
  | 'clob_price_history';

export interface WeatherAlgoDataTableSummary {
  id: WeatherAlgoDataTableId;
  tableName: string;
  rowCount: number;
  oldestAt: string | null;
  newestAt: string | null;
}

export interface WeatherAlgoDataTablesResponse {
  tables: WeatherAlgoDataTableSummary[];
}

export interface WeatherAlgoDataDeleteAllResponse {
  deleted: Record<WeatherAlgoDataTableId, number>;
  totalDeleted: number;
}

export interface WeatherAlgoDataDeleteTableResponse {
  id: WeatherAlgoDataTableId;
  deleted: number;
  /** Lignes supprimées en cascade (ex: bucket_ticks quand on supprime market_snapshots). */
  cascaded: number;
}

async function deleteAllRows(
  ds: DataSource,
  entity: new () => object,
): Promise<number> {
  const result = await ds
    .createQueryBuilder()
    .delete()
    .from(entity)
    .where('1 = 1')
    .execute();
  return result.affected ?? 0;
}

const TABLE_ENTITY_MAP: Record<WeatherAlgoDataTableId, new () => object> = {
  forecast_history: WeatherForecastHistory,
  market_snapshots: WeatherMarketSnapshot,
  bucket_ticks: WeatherBucketTick,
  evaluation_log: WeatherEvaluationLog,
  forecast_cache: WeatherForecastCache,
  position_forecasts: WeatherPositionForecast,
  clob_price_history: WeatherClobPriceHistory,
};

export interface WeatherAlgoDataCoverage {
  from: string | null;
  to: string | null;
  cities: string[];
  totalSnapshots: number;
  totalEvaluations: number;
  totalForecastHistory: number;
  totalBucketTicks: number;
}

export type WeatherPositionForecastRow = WeatherPositionForecast & {
  openedAt: string | null;
};

export type WeatherBucketTickRow = WeatherBucketTick & {
  cityNormalized: string | null;
};

export interface BucketTickDateEntry {
  targetDateIso: string;
  cityCount: number;
  tickCount: number;
}

export interface BucketTimelineSeriesPoint {
  recordedAt: string;
  yesPrice: number | null;
}

export interface BucketTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  series: BucketTimelineSeriesPoint[];
}

export interface BucketTimelineCity {
  cityNormalized: string;
  forecastMean: number | null;
  forecastStdDev: number | null;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: BucketTimelineBucket[];
}

export interface BucketTimelineDate {
  targetDateIso: string;
  cities: BucketTimelineCity[];
}

export interface BucketTimelineResponse {
  dates: BucketTimelineDate[];
}

export interface ClobPriceHistoryDateEntry {
  targetDate: string;
  cityCount: number;
  tickCount: number;
}

export interface ClobTimelineSeriesPoint {
  recordedAt: string;
  price: number;
  side: 'YES' | 'NO';
}

export interface ClobTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  series: ClobTimelineSeriesPoint[];
}

export interface ClobTimelineCity {
  cityNormalized: string;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: ClobTimelineBucket[];
}

export interface ClobTimelineDate {
  targetDate: string;
  cities: ClobTimelineCity[];
}

export interface ClobTimelineResponse {
  dates: ClobTimelineDate[];
}

/**
 * Re-sort rows fetched DESC (most recent first, so the resolution tail is kept
 * within the maxTicks limit) back into chronological ASC order for display.
 */
function sortByRecordedAtAsc<T extends { recordedAt: Date; id: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const d = a.recordedAt.getTime() - b.recordedAt.getTime();
    return d !== 0 ? d : a.id - b.id;
  });
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Convertit une valeur date (Date ou string) en `YYYY-MM-DD`, ou null si invalide. */
function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function countMinMax(
  ds: DataSource,
  entity: new () => object,
  alias: string,
  tsColumn: string,
): Promise<{ rowCount: number; oldestAt: string | null; newestAt: string | null }> {
  const row = await ds
    .getRepository(entity)
    .createQueryBuilder(alias)
    .select(`COUNT(${alias}.id)`, 'cnt')
    .addSelect(`MIN(${alias}.${tsColumn})`, 'minAt')
    .addSelect(`MAX(${alias}.${tsColumn})`, 'maxAt')
    .getRawOne<{ cnt: string | number; minAt: Date | string | null; maxAt: Date | string | null }>();

  return {
    rowCount: Number(row?.cnt ?? 0),
    oldestAt: toIso(row?.minAt ?? null),
    newestAt: toIso(row?.maxAt ?? null),
  };
}

export class WeatherAlgoDataService {
  constructor(private readonly ds: DataSource) {}

  async listForecastHistory(options: {
    city?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherForecastHistory[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherForecastHistory)
      .createQueryBuilder('h')
      .orderBy('h.fetchedAt', 'DESC');

    if (options.city) {
      qb.andWhere('LOWER(h.city) = LOWER(:city)', { city: options.city.trim() });
    }
    if (options.from) {
      qb.andWhere('h.fetchedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('h.fetchedAt <= :to', { to: options.to });
    }

    const [items, total] = await qb.skip(options.offset).take(options.limit).getManyAndCount();
    return { items, total };
  }

  async listMarketSnapshots(options: {
    city?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
    includeTicks?: boolean;
  }): Promise<{
    items: Array<WeatherMarketSnapshot & { bucketTicks?: WeatherBucketTick[] }>;
    total: number;
  }> {
    const qb = this.ds
      .getRepository(WeatherMarketSnapshot)
      .createQueryBuilder('s')
      .orderBy('s.recordedAt', 'DESC');

    if (options.city) {
      qb.andWhere('s.cityNormalized = :city', {
        city: options.city.trim().toLowerCase(),
      });
    }
    if (options.from) {
      qb.andWhere('s.recordedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('s.recordedAt <= :to', { to: options.to });
    }

    const [snapshots, total] = await qb.skip(options.offset).take(options.limit).getManyAndCount();
    if (snapshots.length === 0 || !options.includeTicks) {
      return { items: snapshots, total };
    }

    const snapshotIds = snapshots.map((s) => s.id);
    const ticks = await this.ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .where('t.snapshotId IN (:...snapshotIds)', { snapshotIds })
      .orderBy('t.id', 'ASC')
      .getMany();

    const ticksBySnapshot = new Map<number, WeatherBucketTick[]>();
    for (const tick of ticks) {
      const arr = ticksBySnapshot.get(tick.snapshotId);
      if (arr) arr.push(tick);
      else ticksBySnapshot.set(tick.snapshotId, [tick]);
    }

    const items = snapshots.map((s) => ({
      ...s,
      bucketTicks: ticksBySnapshot.get(s.id) ?? [],
    }));

    return { items, total };
  }

  async listClobPriceHistory(options: {
    city?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherClobPriceHistory[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherClobPriceHistory)
      .createQueryBuilder('h')
      .orderBy('h.recordedAt', 'DESC');

    if (options.city) {
      qb.andWhere('LOWER(h.city) = LOWER(:city)', { city: options.city.trim() });
    }
    if (options.from) {
      qb.andWhere('h.recordedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('h.recordedAt <= :to', { to: options.to });
    }

    const [items, total] = await qb.skip(options.offset).take(options.limit).getManyAndCount();
    return { items, total };
  }

  async listBucketTicks(options: {
    city?: string;
    conditionId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherBucketTickRow[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .leftJoin(WeatherMarketSnapshot, 's', 's.id = t.snapshotId');

    if (options.city) {
      qb.andWhere('s.cityNormalized = :city', {
        city: options.city.trim().toLowerCase(),
      });
    }
    if (options.conditionId) {
      qb.andWhere('t.conditionId = :conditionId', { conditionId: options.conditionId });
    }
    if (options.from) {
      qb.andWhere('t.recordedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('t.recordedAt <= :to', { to: options.to });
    }

    const total = await qb.clone().getCount();

    const { entities, raw } = await qb
      .addSelect('s.cityNormalized', 'city_normalized')
      .orderBy('t.recordedAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getRawAndEntities();

    const items: WeatherBucketTickRow[] = entities.map((entity, i) => ({
      ...entity,
      cityNormalized:
        typeof raw[i]?.city_normalized === 'string' ? raw[i].city_normalized : null,
    }));

    return { items, total };
  }

  async listBucketTickDates(): Promise<{ dates: BucketTickDateEntry[] }> {
    const rows = await this.ds
      .getRepository(WeatherMarketSnapshot)
      .createQueryBuilder('s')
      .innerJoin(WeatherBucketTick, 't', 't.snapshotId = s.id')
      .select('s.targetDateIso', 'targetDateIso')
      .addSelect('COUNT(DISTINCT s.cityNormalized)', 'cityCount')
      .addSelect('COUNT(t.id)', 'tickCount')
      .groupBy('s.targetDateIso')
      .orderBy('s.targetDateIso', 'DESC')
      .getRawMany<{
        targetDateIso: string;
        cityCount: string | number;
        tickCount: string | number;
      }>();

    const dates: BucketTickDateEntry[] = rows
      .filter((r) => typeof r.targetDateIso === 'string' && r.targetDateIso)
      .map((r) => ({
        targetDateIso: r.targetDateIso,
        cityCount: Number(r.cityCount ?? 0),
        tickCount: Number(r.tickCount ?? 0),
      }));

    return { dates };
  }

  async getBucketTicksTimeline(options: {
    targetDateIso: string;
    city?: string;
    from?: Date;
    to?: Date;
    maxTicks?: number;
  }): Promise<BucketTimelineResponse> {
    const target = options.targetDateIso.trim();
    if (!target) return { dates: [] };

    const maxTicks = Math.max(1, Math.min(options.maxTicks ?? 2000, 5000));

    // D.1 — Une seule requête bornée via innerJoin snapshot↔tick.
    // Évite de charger tous les snapshots puis un IN (:...ids) non borné
    // (risque d'explosion PostgreSQL >65k paramètres sur une date très active).
    const tickQb = this.ds
      .getRepository(WeatherBucketTick)
      .createQueryBuilder('t')
      .innerJoin(WeatherMarketSnapshot, 's', 's.id = t.snapshotId')
      .where('s.targetDateIso = :target', { target });

    if (options.city) {
      tickQb.andWhere('s.cityNormalized = :city', {
        city: options.city.trim().toLowerCase(),
      });
    }
    if (options.from) {
      tickQb.andWhere('s.recordedAt >= :from', { from: options.from });
    }
    if (options.to) {
      tickQb.andWhere('s.recordedAt <= :to', { to: options.to });
    }

    // D.2 — Fetch the most recent `maxTicks` ticks (DESC) so the resolution
    // tail (winning bucket at 1.00) is never truncated, then re-sort ASC for
    // chronological series and coherent first/lastRecordedAt.
    const ticks = await tickQb
      .orderBy('t.recordedAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .limit(maxTicks)
      .getMany();

    sortByRecordedAtAsc(ticks);

    if (ticks.length === 0) {
      return { dates: [] };
    }

    // Snapshots distincts requis pour résoudre city/forecast : on ne charge
    // que ceux effectivement référencés par les ticks retournés (borne ≤ maxTicks).
    const snapshotIds = [...new Set(ticks.map((t) => t.snapshotId))];
    const snapshots = await this.ds
      .getRepository(WeatherMarketSnapshot)
      .createQueryBuilder('s')
      .where('s.id IN (:...snapshotIds)', { snapshotIds })
      .getMany();

    // D.4 — Tri explicite des snapshots par recordedAt pour déterminer
    // le « dernier » (forecastMean) indépendamment de l'ordre d'insertion.
    snapshots.sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );

    const snapshotById = new Map<number, WeatherMarketSnapshot>();
    for (const s of snapshots) snapshotById.set(s.id, s);

    // D.3 — Accumulateur avec Map<conditionId, bucket> par ville (lookup O(1)).
    interface CityAccumulator {
      city: BucketTimelineCity;
      bucketMap: Map<string, BucketTimelineBucket>;
    }
    const cityMap = new Map<string, CityAccumulator>();

    for (const tick of ticks) {
      const snap = snapshotById.get(tick.snapshotId);
      if (!snap) continue;
      const cityKey = snap.cityNormalized || snap.city;

      let acc = cityMap.get(cityKey);
      if (!acc) {
        acc = {
          city: {
            cityNormalized: cityKey,
            forecastMean: snap.forecastMean,
            forecastStdDev: snap.forecastStdDev,
            bucketCount: 0,
            firstRecordedAt: toIso(tick.recordedAt) ?? '',
            lastRecordedAt: toIso(tick.recordedAt) ?? '',
            buckets: [],
          },
          bucketMap: new Map(),
        };
        cityMap.set(cityKey, acc);
      }

      // Ticks triés par recordedAt ASC : chaque tick est plus récent ou égal
      // au précédent, donc on écrase lastRecordedAt et forecastMean à chaque
      // tick (le dernier tick de la boucle = le plus récent).
      acc.city.lastRecordedAt = toIso(tick.recordedAt) ?? acc.city.lastRecordedAt;
      acc.city.forecastMean = snap.forecastMean;
      acc.city.forecastStdDev = snap.forecastStdDev;

      const ts = toIso(tick.recordedAt);
      const point: BucketTimelineSeriesPoint = {
        recordedAt: ts ?? '',
        yesPrice: tick.yesPrice,
      };

      let bucket = acc.bucketMap.get(tick.conditionId);
      if (!bucket) {
        bucket = {
          conditionId: tick.conditionId,
          bucketComparison: tick.bucketComparison,
          bucketTarget: tick.bucketTarget,
          bucketLow: tick.bucketLow,
          bucketHigh: tick.bucketHigh,
          series: [],
        };
        acc.bucketMap.set(tick.conditionId, bucket);
      }
      bucket.series.push(point);
    }

    // Projection : Map → tableau, bucketCount = taille réelle de la Map.
    const cities = [...cityMap.values()]
      .map((acc) => {
        acc.city.buckets = [...acc.bucketMap.values()];
        acc.city.bucketCount = acc.bucketMap.size;
        return acc.city;
      })
      .sort((a, b) => a.cityNormalized.localeCompare(b.cityNormalized));

    return { dates: [{ targetDateIso: target, cities }] };
  }

  async listClobPriceHistoryDates(): Promise<{ dates: ClobPriceHistoryDateEntry[] }> {
    const rows = await this.ds
      .getRepository(WeatherClobPriceHistory)
      .createQueryBuilder('h')
      .select('h.targetDate', 'targetDate')
      .addSelect('COUNT(DISTINCT h.city)', 'cityCount')
      .addSelect('COUNT(h.id)', 'tickCount')
      .groupBy('h.targetDate')
      .orderBy('h.targetDate', 'DESC')
      .getRawMany<{
        targetDate: Date | string;
        cityCount: string | number;
        tickCount: string | number;
      }>();

    const dates: ClobPriceHistoryDateEntry[] = rows
      .map((r) => {
        const targetDate = toDateOnly(r.targetDate);
        if (!targetDate) return null;
        return {
          targetDate,
          cityCount: Number(r.cityCount ?? 0),
          tickCount: Number(r.tickCount ?? 0),
        };
      })
      .filter((d): d is ClobPriceHistoryDateEntry => d !== null);

    return { dates };
  }

  async getClobPriceHistoryTimeline(options: {
    targetDate: string;
    city?: string;
    from?: Date;
    to?: Date;
    maxTicks?: number;
  }): Promise<ClobTimelineResponse> {
    const target = options.targetDate.trim();
    if (!target) return { dates: [] };

    const maxTicks = Math.max(1, Math.min(options.maxTicks ?? 2000, 5000));

    const qb = this.ds
      .getRepository(WeatherClobPriceHistory)
      .createQueryBuilder('h')
      .where('h.targetDate = :target', { target });

    if (options.city) {
      qb.andWhere('LOWER(h.city) = LOWER(:city)', { city: options.city.trim() });
    }
    if (options.from) {
      qb.andWhere('h.recordedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('h.recordedAt <= :to', { to: options.to });
    }

    // Fetch the most recent `maxTicks` points (DESC) so the settlement point
    // (1.00, timestamped after the last trade) is never truncated, then re-sort
    // ASC for chronological display. Sorting ASC before LIMIT would keep only
    // the oldest points and drop the resolution tail.
    const rows = await qb
      .orderBy('h.recordedAt', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .limit(maxTicks)
      .getMany();

    sortByRecordedAtAsc(rows);

    if (rows.length === 0) {
      return { dates: [] };
    }

    interface CityAccumulator {
      city: ClobTimelineCity;
      bucketMap: Map<string, ClobTimelineBucket>;
    }
    const cityMap = new Map<string, CityAccumulator>();

    for (const row of rows) {
      const cityKey = row.city;

      let acc = cityMap.get(cityKey);
      if (!acc) {
        acc = {
          city: {
            cityNormalized: cityKey,
            bucketCount: 0,
            firstRecordedAt: toIso(row.recordedAt) ?? '',
            lastRecordedAt: toIso(row.recordedAt) ?? '',
            buckets: [],
          },
          bucketMap: new Map(),
        };
        cityMap.set(cityKey, acc);
      }

      // Rows triées par recordedAt ASC : chaque ligne est plus récente ou égale
      // à la précédente, donc on écrase lastRecordedAt à chaque itération.
      acc.city.lastRecordedAt = toIso(row.recordedAt) ?? acc.city.lastRecordedAt;

      const point: ClobTimelineSeriesPoint = {
        recordedAt: toIso(row.recordedAt) ?? '',
        price: row.price,
        side: row.side,
      };

      let bucket = acc.bucketMap.get(row.conditionId);
      if (!bucket) {
        bucket = {
          conditionId: row.conditionId,
          bucketComparison: row.bucketComparison,
          bucketTarget: row.bucketTarget,
          bucketLow: row.bucketLow,
          bucketHigh: row.bucketHigh,
          series: [],
        };
        acc.bucketMap.set(row.conditionId, bucket);
      }
      bucket.series.push(point);
    }

    const cities = [...cityMap.values()]
      .map((acc) => {
        acc.city.buckets = [...acc.bucketMap.values()];
        acc.city.bucketCount = acc.bucketMap.size;
        return acc.city;
      })
      .sort((a, b) => a.cityNormalized.localeCompare(b.cityNormalized));

    return { dates: [{ targetDate: target, cities }] };
  }

  async listEvaluationLog(options: {
    from?: Date;
    to?: Date;
    strategyId?: string;
    decision?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherEvaluationLog[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherEvaluationLog)
      .createQueryBuilder('e')
      .orderBy('e.evaluatedAt', 'DESC');

    if (options.from) {
      qb.andWhere('e.evaluatedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('e.evaluatedAt <= :to', { to: options.to });
    }
    if (options.strategyId) {
      qb.andWhere('e.strategyId = :strategyId', { strategyId: options.strategyId });
    }
    if (options.decision) {
      qb.andWhere('e.decision = :decision', { decision: options.decision });
    }

    const [items, total] = await qb.skip(options.offset).take(options.limit).getManyAndCount();
    return { items, total };
  }

  async listForecastCache(options: {
    city?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherForecastCache[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherForecastCache)
      .createQueryBuilder('c')
      .orderBy('c.fetchedAt', 'DESC');

    if (options.city) {
      qb.andWhere('LOWER(c.city) = LOWER(:city)', { city: options.city.trim() });
    }
    if (options.from) {
      qb.andWhere('c.fetchedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('c.fetchedAt <= :to', { to: options.to });
    }

    const [items, total] = await qb.skip(options.offset).take(options.limit).getManyAndCount();
    return { items, total };
  }

  async listPositionForecasts(options: {
    city?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: WeatherPositionForecastRow[]; total: number }> {
    const qb = this.ds
      .getRepository(WeatherPositionForecast)
      .createQueryBuilder('pf')
      .leftJoin(CopiedPosition, 'cp', 'cp.id = pf.copiedPositionId');

    if (options.city) {
      qb.andWhere('LOWER(pf.city) = LOWER(:city)', { city: options.city.trim() });
    }
    if (options.from) {
      qb.andWhere('cp.openedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('cp.openedAt <= :to', { to: options.to });
    }

    const total = await qb.clone().getCount();

    const { entities, raw } = await qb
      .addSelect('cp.openedAt', 'cp_opened_at')
      .orderBy('cp.openedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('pf.id', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getRawAndEntities();

    const items: WeatherPositionForecastRow[] = entities.map((entity, i) => ({
      ...entity,
      openedAt: toIso(raw[i]?.cp_opened_at ?? null),
    }));

    return { items, total };
  }

  /**
   * Wipe all weather-algo recorded tables shown in the Données tab.
   * Order respects FKs: ticks → evaluation_log → snapshots → history/cache/position_forecasts.
   */
  async deleteAllRecordedData(): Promise<WeatherAlgoDataDeleteAllResponse> {
    const bucket_ticks = await deleteAllRows(this.ds, WeatherBucketTick);
    const evaluation_log = await deleteAllRows(this.ds, WeatherEvaluationLog);
    const market_snapshots = await deleteAllRows(this.ds, WeatherMarketSnapshot);
    const forecast_history = await deleteAllRows(this.ds, WeatherForecastHistory);
    const forecast_cache = await deleteAllRows(this.ds, WeatherForecastCache);
    const position_forecasts = await deleteAllRows(this.ds, WeatherPositionForecast);
    const clob_price_history = await deleteAllRows(this.ds, WeatherClobPriceHistory);

    const deleted: Record<WeatherAlgoDataTableId, number> = {
      bucket_ticks,
      evaluation_log,
      market_snapshots,
      forecast_history,
      forecast_cache,
      position_forecasts,
      clob_price_history,
    };
    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
    log.info({ deleted, totalDeleted }, 'deleted all weather algo recorded data');
    return { deleted, totalDeleted };
  }

  /**
   * Wipe a single weather-algo recorded table identified by its Données-tab id.
   * Deleting `market_snapshots` also deletes its dependent `bucket_ticks` (logical FK
   * via snapshotId) to avoid orphan rows.
   */
  async deleteTableData(id: WeatherAlgoDataTableId): Promise<WeatherAlgoDataDeleteTableResponse> {
    const entity = TABLE_ENTITY_MAP[id];
    const deleted = await deleteAllRows(this.ds, entity);

    // Cascade: bucket_ticks référence market_snapshots via snapshotId (FK logique).
    let cascaded = 0;
    if (id === 'market_snapshots') {
      cascaded = await deleteAllRows(this.ds, WeatherBucketTick);
    }

    log.info({ id, deleted, cascaded }, 'deleted weather algo table data');
    return { id, deleted, cascaded };
  }

  async getTablesSummary(): Promise<WeatherAlgoDataTablesResponse> {
    const [
      forecastHistory,
      marketSnapshots,
      bucketTicks,
      evaluationLog,
      forecastCache,
      positionForecasts,
      clobPriceHistory,
    ] = await Promise.all([
      countMinMax(this.ds, WeatherForecastHistory, 'h', 'fetchedAt'),
      countMinMax(this.ds, WeatherMarketSnapshot, 's', 'recordedAt'),
      countMinMax(this.ds, WeatherBucketTick, 't', 'recordedAt'),
      countMinMax(this.ds, WeatherEvaluationLog, 'e', 'evaluatedAt'),
      countMinMax(this.ds, WeatherForecastCache, 'c', 'fetchedAt'),
      this.ds
        .getRepository(WeatherPositionForecast)
        .createQueryBuilder('pf')
        .leftJoin(CopiedPosition, 'cp', 'cp.id = pf.copiedPositionId')
        .select('COUNT(pf.id)', 'cnt')
        .addSelect('MIN(cp.openedAt)', 'minAt')
        .addSelect('MAX(cp.openedAt)', 'maxAt')
        .getRawOne<{
          cnt: string | number;
          minAt: Date | string | null;
          maxAt: Date | string | null;
        }>()
        .then((row) => ({
          rowCount: Number(row?.cnt ?? 0),
          oldestAt: toIso(row?.minAt ?? null),
          newestAt: toIso(row?.maxAt ?? null),
        })),
      countMinMax(this.ds, WeatherClobPriceHistory, 'h', 'recordedAt'),
    ]);

    const tables: WeatherAlgoDataTableSummary[] = [
      {
        id: 'forecast_history',
        tableName: 'weather_forecast_history',
        ...forecastHistory,
      },
      {
        id: 'market_snapshots',
        tableName: 'weather_market_snapshots',
        ...marketSnapshots,
      },
      {
        id: 'bucket_ticks',
        tableName: 'weather_bucket_ticks',
        ...bucketTicks,
      },
      {
        id: 'evaluation_log',
        tableName: 'weather_evaluation_log',
        ...evaluationLog,
      },
      {
        id: 'forecast_cache',
        tableName: 'weather_forecast_cache',
        ...forecastCache,
      },
      {
        id: 'position_forecasts',
        tableName: 'weather_position_forecasts',
        ...positionForecasts,
      },
      {
        id: 'clob_price_history',
        tableName: 'weather_clob_price_history',
        ...clobPriceHistory,
      },
    ];

    log.debug({ tables }, 'weather algo data tables summary');
    return { tables };
  }

  async getCoverage(): Promise<WeatherAlgoDataCoverage> {
    const snapshotRepo = this.ds.getRepository(WeatherMarketSnapshot);
    const evalRepo = this.ds.getRepository(WeatherEvaluationLog);
    const historyRepo = this.ds.getRepository(WeatherForecastHistory);
    const tickRepo = this.ds.getRepository(WeatherBucketTick);

    const [totalSnapshots, totalEvaluations, totalForecastHistory, totalBucketTicks] =
      await Promise.all([
        snapshotRepo.count(),
        evalRepo.count(),
        historyRepo.count(),
        tickRepo.count(),
      ]);

    const snapshotRange = await snapshotRepo
      .createQueryBuilder('s')
      .select('MIN(s.recordedAt)', 'minAt')
      .addSelect('MAX(s.recordedAt)', 'maxAt')
      .getRawOne<{ minAt: Date | null; maxAt: Date | null }>();

    const cityRows = await snapshotRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.cityNormalized', 'city')
      .orderBy('s.cityNormalized', 'ASC')
      .getRawMany<{ city: string }>();

    const coverage: WeatherAlgoDataCoverage = {
      from: toIso(snapshotRange?.minAt ?? null),
      to: toIso(snapshotRange?.maxAt ?? null),
      cities: cityRows.map((r) => r.city).filter(Boolean),
      totalSnapshots,
      totalEvaluations,
      totalForecastHistory,
      totalBucketTicks,
    };

    log.debug(coverage, 'weather algo data coverage');
    return coverage;
  }
}
