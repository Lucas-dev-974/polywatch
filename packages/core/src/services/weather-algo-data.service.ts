import pino from 'pino';
import type { DataSource } from 'typeorm';
import { WeatherForecastHistory } from '../entities/WeatherForecastHistory.js';
import { WeatherMarketSnapshot } from '../entities/WeatherMarketSnapshot.js';
import { WeatherBucketTick } from '../entities/WeatherBucketTick.js';
import { WeatherEvaluationLog } from '../entities/WeatherEvaluationLog.js';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';

const log = pino({ name: 'core:weather-algo-data' });

export type WeatherAlgoDataTableId =
  | 'forecast_history'
  | 'market_snapshots'
  | 'bucket_ticks'
  | 'evaluation_log'
  | 'forecast_cache'
  | 'position_forecasts';

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

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

    // D.2 — Tri par recordedAt (et non id) pour garantir l'ordre chronologique
    // des séries et la cohérence de first/lastRecordedAt.
    const ticks = await tickQb
      .orderBy('t.recordedAt', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .limit(maxTicks)
      .getMany();

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

    const deleted: Record<WeatherAlgoDataTableId, number> = {
      bucket_ticks,
      evaluation_log,
      market_snapshots,
      forecast_history,
      forecast_cache,
      position_forecasts,
    };
    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
    log.info({ deleted, totalDeleted }, 'deleted all weather algo recorded data');
    return { deleted, totalDeleted };
  }

  async getTablesSummary(): Promise<WeatherAlgoDataTablesResponse> {
    const [
      forecastHistory,
      marketSnapshots,
      bucketTicks,
      evaluationLog,
      forecastCache,
      positionForecasts,
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
