import pino from 'pino';
import type { DataSource } from 'typeorm';
import { AlgoPriceTick } from '../entities/AlgoPriceTick.js';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import { PostEntryMidSample } from '../entities/PostEntryMidSample.js';
import { AlgoMarketSelection } from '../entities/AlgoMarketSelection.js';
import { AlgoAutoTrackRule } from '../entities/AlgoAutoTrackRule.js';
import { Execution } from '../entities/Execution.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { AlgoSurveillanceService } from './algo-surveillance.service.js';
import type { AlgoSurveillanceSnapshotDto } from './algo-surveillance.types.js';

const log = pino({ name: 'core:crypto-algo-data' });

/**
 * Tables exposées dans l'onglet « Données » de la page crypto-algo.
 *
 * `executions` et `positions` sont en LECTURE SEULE : elles sont partagées avec
 * le copy-trading, leur suppression serait destructrice pour d'autres flux.
 */
export const CRYPTO_ALGO_DATA_TABLE_IDS = [
  'price_ticks',
  'surveillance_snapshots',
  'post_entry_mid_samples',
  'market_selections',
  'auto_track_rules',
  'executions',
  'positions',
] as const;

export type CryptoAlgoDataTableId = (typeof CRYPTO_ALGO_DATA_TABLE_IDS)[number];

/** Tables dont la suppression est autorisée (hors executions/positions). */
const DELETABLE_TABLE_IDS: readonly CryptoAlgoDataTableId[] = [
  'price_ticks',
  'surveillance_snapshots',
  'post_entry_mid_samples',
  'market_selections',
  'auto_track_rules',
];

export interface CryptoAlgoDataTableSummary {
  id: CryptoAlgoDataTableId;
  tableName: string;
  rowCount: number;
  oldestAt: string | null;
  newestAt: string | null;
  /** True quand la table est en lecture seule (partagée avec le copy-trading). */
  readOnly: boolean;
}

export interface CryptoAlgoDataTablesResponse {
  tables: CryptoAlgoDataTableSummary[];
}

export interface CryptoAlgoDataDeleteAllResponse {
  deleted: Record<CryptoAlgoDataTableId, number>;
  totalDeleted: number;
}

export interface CryptoAlgoDataDeleteTableResponse {
  id: CryptoAlgoDataTableId;
  deleted: number;
}

export interface CryptoAlgoDataCoverage {
  from: string | null;
  to: string | null;
  symbols: string[];
  totalPriceTicks: number;
  totalSurveillanceSnapshots: number;
  totalPostEntryMidSamples: number;
  totalMarketSelections: number;
  totalAutoTrackRules: number;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

async function countMinMax(
  ds: DataSource,
  entity: new () => object,
  alias: string,
  tsColumn: string,
  where?: (qb: { andWhere: (sql: string, params: Record<string, unknown>) => void }) => void,
): Promise<{ rowCount: number; oldestAt: string | null; newestAt: string | null }> {
  const qb = ds
    .getRepository(entity)
    .createQueryBuilder(alias)
    .select(`COUNT(${alias}.id)`, 'cnt')
    .addSelect(`MIN(${alias}.${tsColumn})`, 'minAt')
    .addSelect(`MAX(${alias}.${tsColumn})`, 'maxAt');
  where?.(qb as never);
  const row = await qb.getRawOne<{
    cnt: string | number;
    minAt: Date | string | null;
    maxAt: Date | string | null;
  }>();

  return {
    rowCount: Number(row?.cnt ?? 0),
    oldestAt: toIso(row?.minAt ?? null),
    newestAt: toIso(row?.maxAt ?? null),
  };
}

export class CryptoAlgoDataService {
  constructor(private readonly ds: DataSource) {}

  private surveillanceService(): AlgoSurveillanceService {
    return new AlgoSurveillanceService(this.ds);
  }

  // ── Listings paginés ─────────────────────────────────────────────────────

  async listPriceTicks(options: {
    conditionId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: AlgoPriceTick[]; total: number }> {
    const qb = this.ds
      .getRepository(AlgoPriceTick)
      .createQueryBuilder('t')
      .orderBy('t.recorded_at', 'DESC')
      .addOrderBy('t.id', 'DESC');

    if (options.conditionId) {
      qb.andWhere('t.condition_id = :conditionId', {
        conditionId: options.conditionId,
      });
    }
    if (options.from) {
      qb.andWhere('t.recorded_at >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('t.recorded_at <= :to', { to: options.to });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listSurveillanceSnapshots(options: {
    limit: number;
    offset: number;
  }): Promise<{ items: AlgoSurveillanceSnapshotDto[]; total: number }> {
    return this.surveillanceService().listHistory(options.limit, options.offset);
  }

  async listPostEntryMidSamples(options: {
    conditionId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: PostEntryMidSample[]; total: number }> {
    const qb = this.ds
      .getRepository(PostEntryMidSample)
      .createQueryBuilder('s')
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'DESC');

    if (options.conditionId) {
      qb.andWhere('s.condition_id = :conditionId', {
        conditionId: options.conditionId,
      });
    }
    if (options.from) {
      qb.andWhere('s.created_at >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('s.created_at <= :to', { to: options.to });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listMarketSelections(options: {
    enabled?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ items: AlgoMarketSelection[]; total: number }> {
    const qb = this.ds
      .getRepository(AlgoMarketSelection)
      .createQueryBuilder('s')
      .orderBy('s.created_at', 'DESC')
      .addOrderBy('s.id', 'DESC');

    if (options.enabled !== undefined) {
      qb.andWhere('s.enabled = :enabled', { enabled: options.enabled });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listAutoTrackRules(options: {
    enabled?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ items: AlgoAutoTrackRule[]; total: number }> {
    const qb = this.ds
      .getRepository(AlgoAutoTrackRule)
      .createQueryBuilder('r')
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC');

    if (options.enabled !== undefined) {
      qb.andWhere('r.enabled = :enabled', { enabled: options.enabled });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listExecutions(options: {
    conditionId?: string;
    mode?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: Execution[]; total: number }> {
    const qb = this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .andWhere('e.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' })
      .orderBy('e.executed_at', 'DESC')
      .addOrderBy('e.id', 'DESC');

    if (options.conditionId) {
      qb.innerJoin('CopiedPosition', 'cp', 'cp.id = e.copied_position_id');
      qb.andWhere('cp.condition_id = :conditionId', {
        conditionId: options.conditionId,
      });
    }
    if (options.mode) {
      qb.andWhere('e.mode = :mode', { mode: options.mode });
    }
    if (options.status) {
      qb.andWhere('e.status = :status', { status: options.status });
    }
    if (options.from) {
      qb.andWhere('e.executed_at >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('e.executed_at <= :to', { to: options.to });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listPositions(options: {
    conditionId?: string;
    mode?: string;
    status?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: CopiedPosition[]; total: number }> {
    const qb = this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .andWhere('p.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' })
      .orderBy('p.opened_at', 'DESC')
      .addOrderBy('p.id', 'DESC');

    if (options.conditionId) {
      qb.andWhere('p.condition_id = :conditionId', {
        conditionId: options.conditionId,
      });
    }
    if (options.mode) {
      qb.andWhere('p.mode = :mode', { mode: options.mode });
    }
    if (options.status) {
      qb.andWhere('p.status = :status', { status: options.status });
    }
    if (options.from) {
      qb.andWhere('p.opened_at >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('p.opened_at <= :to', { to: options.to });
    }

    const [items, total] = await qb
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();
    return { items, total };
  }

  // ── Suppression (hors executions/positions, lecture seule) ───────────────

  async deleteAllRecordedData(): Promise<CryptoAlgoDataDeleteAllResponse> {
    const price_ticks = await deleteAllRows(this.ds, AlgoPriceTick);
    const surveillance_snapshots = await deleteAllRows(
      this.ds,
      AlgoSurveillanceSnapshot,
    );
    const post_entry_mid_samples = await deleteAllRows(
      this.ds,
      PostEntryMidSample,
    );
    const market_selections = await deleteAllRows(this.ds, AlgoMarketSelection);
    const auto_track_rules = await deleteAllRows(this.ds, AlgoAutoTrackRule);

    const deleted: Record<CryptoAlgoDataTableId, number> = {
      price_ticks,
      surveillance_snapshots,
      post_entry_mid_samples,
      market_selections,
      auto_track_rules,
      executions: 0,
      positions: 0,
    };
    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
    log.info({ deleted, totalDeleted }, 'deleted all crypto algo recorded data');
    return { deleted, totalDeleted };
  }

  async deleteTableData(
    id: CryptoAlgoDataTableId,
  ): Promise<CryptoAlgoDataDeleteTableResponse> {
    if (!DELETABLE_TABLE_IDS.includes(id)) {
      throw new Error('read_only_table');
    }

    const entityMap: Record<CryptoAlgoDataTableId, new () => object> = {
      price_ticks: AlgoPriceTick,
      surveillance_snapshots: AlgoSurveillanceSnapshot,
      post_entry_mid_samples: PostEntryMidSample,
      market_selections: AlgoMarketSelection,
      auto_track_rules: AlgoAutoTrackRule,
      executions: Execution,
      positions: CopiedPosition,
    };

    const deleted = await deleteAllRows(this.ds, entityMap[id]);
    log.info({ id, deleted }, 'deleted crypto algo table data');
    return { id, deleted };
  }

  // ── Résumé / couverture ───────────────────────────────────────────────────

  async getTablesSummary(): Promise<CryptoAlgoDataTablesResponse> {
    const [
      priceTicks,
      surveillanceSnapshots,
      postEntryMidSamples,
      marketSelections,
      autoTrackRules,
      executions,
      positions,
    ] = await Promise.all([
      countMinMax(this.ds, AlgoPriceTick, 't', 'recorded_at'),
      countMinMax(this.ds, AlgoSurveillanceSnapshot, 's', 'created_at'),
      countMinMax(this.ds, PostEntryMidSample, 'm', 'created_at'),
      countMinMax(this.ds, AlgoMarketSelection, 's', 'created_at'),
      countMinMax(this.ds, AlgoAutoTrackRule, 'r', 'created_at'),
      countMinMax(this.ds, Execution, 'e', 'executed_at', (qb) =>
        qb.andWhere('e.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' }),
      ),
      countMinMax(this.ds, CopiedPosition, 'p', 'opened_at', (qb) =>
        qb.andWhere('p.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' }),
      ),
    ]);

    const tables: CryptoAlgoDataTableSummary[] = [
      {
        id: 'price_ticks',
        tableName: 'algo_price_ticks',
        ...priceTicks,
        readOnly: false,
      },
      {
        id: 'surveillance_snapshots',
        tableName: 'algo_surveillance_snapshots',
        ...surveillanceSnapshots,
        readOnly: false,
      },
      {
        id: 'post_entry_mid_samples',
        tableName: 'post_entry_mid_samples',
        ...postEntryMidSamples,
        readOnly: false,
      },
      {
        id: 'market_selections',
        tableName: 'algo_market_selections',
        ...marketSelections,
        readOnly: false,
      },
      {
        id: 'auto_track_rules',
        tableName: 'algo_auto_track_rules',
        ...autoTrackRules,
        readOnly: false,
      },
      {
        id: 'executions',
        tableName: 'executions (ALGO_%)',
        ...executions,
        readOnly: true,
      },
      {
        id: 'positions',
        tableName: 'copied_positions (ALGO_%)',
        ...positions,
        readOnly: true,
      },
    ];

    log.debug({ tables }, 'crypto algo data tables summary');
    return { tables };
  }

  async getCoverage(): Promise<CryptoAlgoDataCoverage> {
    const [totalPriceTicks, totalSurveillanceSnapshots, totalPostEntryMidSamples] =
      await Promise.all([
        this.ds.getRepository(AlgoPriceTick).count(),
        this.ds.getRepository(AlgoSurveillanceSnapshot).count(),
        this.ds.getRepository(PostEntryMidSample).count(),
      ]);

    const [totalMarketSelections, totalAutoTrackRules] = await Promise.all([
      this.ds.getRepository(AlgoMarketSelection).count(),
      this.ds.getRepository(AlgoAutoTrackRule).count(),
    ]);

    const range = await this.ds
      .getRepository(AlgoPriceTick)
      .createQueryBuilder('t')
      .select('MIN(t.recorded_at)', 'minAt')
      .addSelect('MAX(t.recorded_at)', 'maxAt')
      .getRawOne<{ minAt: Date | null; maxAt: Date | null }>();

    const symbolRows = await this.ds
      .getRepository(AlgoMarketSelection)
      .createQueryBuilder('s')
      .select('DISTINCT s.crypto_symbol', 'symbol')
      .where('s.crypto_symbol IS NOT NULL')
      .orderBy('s.crypto_symbol', 'ASC')
      .getRawMany<{ symbol: string }>();

    const coverage: CryptoAlgoDataCoverage = {
      from: toIso(range?.minAt ?? null),
      to: toIso(range?.maxAt ?? null),
      symbols: symbolRows.map((r) => r.symbol).filter(Boolean),
      totalPriceTicks,
      totalSurveillanceSnapshots,
      totalPostEntryMidSamples,
      totalMarketSelections,
      totalAutoTrackRules,
    };

    log.debug(coverage, 'crypto algo data coverage');
    return coverage;
  }
}
