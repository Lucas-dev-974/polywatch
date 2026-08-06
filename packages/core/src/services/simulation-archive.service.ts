import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';
import { SimulationSession } from '../entities/SimulationSession.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { SimulationSessionService } from './simulation-session.service.js';
import type { SimRiskConfigSnapshot } from '../risk/sim-mode-fields.js';
import { withAutoSnapshotCreationLock } from '../simulation/auto-snapshot-lock.js';
import {
  isAutoSnapshotDueByAge,
  MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
} from '../simulation/auto-snapshot-timing.js';
import { buildSimTraderRollup } from '../simulation/trader-rollup.js';
import { algoKindFromReason, type SimAlgoKind } from '../simulation/algo-kind.js';
import {
  collectSimDecisionPayload,
  type SimSnapshotDecisionSummary,
} from '../simulation/snapshot-decision-collector.js';
import { applyDecisionPayloadByteBudget } from '../snapshot/decision-collector-shared.js';
import { isPostgres } from '../lib/is-postgres.js';
import {
  CopiedPositionPresenter,
  type EnrichedCopiedPosition,
} from './copied-position-presenter.js';
import { RiskService } from './risk.service.js';
import { SimulationService } from './simulation.service.js';
import {
  type CreateSimStateSnapshotOptions,
  type ListSimSnapshotsOptions,
  type SimStateSnapshotDetail,
  type SimStateSnapshotSummary,
  safeParseJson,
} from '../types/sim-state-snapshot.js';

function toSummary(
  row: SimulationStateSnapshot,
  sessionLabel: string | null = null,
): SimStateSnapshotSummary {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    label: row.label,
    source: row.source,
    sessionId: row.sessionId ?? null,
    sessionLabel,
    amount: row.amount,
    token: row.token,
    positionsValue: row.positionsValue,
    equity: row.equity,
    openPnlSum: row.openPnlSum,
    closedPnlSum: row.closedPnlSum,
    baselineCapital: row.baselineCapital,
    positionCount: row.positionCount,
    openPositionCount: row.openPositionCount,
    closedPositionCount: row.closedPositionCount,
    executionCount: row.executionCount,
    traderCount: row.traderCount,
    tradersLabel: row.tradersLabel,
    sessionPnl: row.equity - row.baselineCapital,
  };
}

/** Columns needed to build a SimStateSnapshotSummary (excludes heavy JSON blobs). */
const SNAPSHOT_SUMMARY_COLUMNS: string[] = [
  's.id', 's.createdAt', 's.label', 's.source', 's.sessionId',
  's.amount', 's.token', 's.positionsValue', 's.equity',
  's.openPnlSum', 's.closedPnlSum', 's.baselineCapital',
  's.positionCount', 's.openPositionCount', 's.closedPositionCount',
  's.executionCount', 's.traderCount', 's.tradersLabel',
];

export class SimulationArchiveService {
  private simulationService: SimulationService;
  private riskService: RiskService;
  private presenter: CopiedPositionPresenter;
  private sessionService: SimulationSessionService;

  constructor(private readonly ds: DataSource) {
    this.simulationService = new SimulationService(ds);
    this.riskService = new RiskService(ds);
    this.presenter = new CopiedPositionPresenter(ds);
    this.sessionService = new SimulationSessionService(ds);
  }

  async createSnapshot(
    options: CreateSimStateSnapshotOptions,
  ): Promise<SimStateSnapshotSummary | null> {
    return this.ds.transaction(async (manager) =>
      this.persistSnapshot(manager, options),
    );
  }

  /**
   * Creates an auto snapshot only when the configured interval has elapsed.
   * Uses a DB lock and re-checks inside the transaction to prevent bursts from
   * concurrent ticks or multiple backend processes.
   *
   * The elapsed time is computed by the database clock (not JS `Date`) because
   * `created_at` is a `timestamp without time zone`: the driver would otherwise
   * reinterpret the stored UTC value in the local timezone, skewing the gap.
   */
  async createAutoSnapshotIfDue(options: {
    intervalSec: number;
    minIntervalSec?: number;
    label?: string | null;
  }): Promise<SimStateSnapshotSummary[]> {
    const minIntervalSec =
      options.minIntervalSec ?? MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS;
    const created: SimStateSnapshotSummary[] = [];

    for (const algoKind of ['crypto', 'weather', 'copy'] as const) {
      const ageSeconds = await this.lastAutoSnapshotAgeSeconds(
        this.ds.manager,
        algoKind,
      );
      if (!isAutoSnapshotDueByAge(options.intervalSec, ageSeconds, minIntervalSec)) {
        continue;
      }

      const summary = await withAutoSnapshotCreationLock(this.ds, async (manager) => {
        const lockedAgeSeconds = await this.lastAutoSnapshotAgeSeconds(
          manager,
          algoKind,
        );
        if (
          !isAutoSnapshotDueByAge(
            options.intervalSec,
            lockedAgeSeconds,
            minIntervalSec,
          )
        ) {
          return null;
        }

        return this.persistSnapshot(manager, {
          algoKind,
          source: 'auto',
          label: options.label ?? 'Automatique',
          skipIfEmpty: true,
        });
      });
      if (summary) created.push(summary);
    }

    return created;
  }

  /**
   * Seconds elapsed since the most recent `auto` snapshot, computed by the
   * database clock. Returns null when no auto snapshot exists yet.
   */
  private async lastAutoSnapshotAgeSeconds(
    manager: EntityManager,
    algoKind: SimAlgoKind,
  ): Promise<number | null> {
    const sql = isPostgres(this.ds)
      ? `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS age
         FROM simulation_state_snapshots
         WHERE source = 'auto' AND algo_kind = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      : `SELECT (julianday('now') - julianday(created_at)) * 86400 AS age
         FROM simulation_state_snapshots
         WHERE source = 'auto' AND algo_kind = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`;
    const rows = (await manager.query(sql, [algoKind])) as Array<{
      age: number | string;
    }>;
    if (!rows || rows.length === 0) return null;
    const age = Number(rows[0].age);
    return Number.isFinite(age) ? age : null;
  }

  private async persistSnapshot(
    manager: EntityManager,
    options: CreateSimStateSnapshotOptions,
  ): Promise<SimStateSnapshotSummary | null> {
    const algoKind = options.algoKind;
    const allPositions = await manager.getRepository(CopiedPosition).find({
      where: { mode: 'sim' },
      order: { id: 'ASC' },
    });
    const positions = allPositions.filter(
      (p) => algoKindFromReason(p.reason) === algoKind,
    );
    const positionIds = positions.map((p) => p.id);
    const executions =
      positionIds.length > 0
        ? await manager.getRepository(Execution).find({
            where: { mode: 'sim', copiedPositionId: In(positionIds) },
            order: { executedAt: 'ASC', id: 'ASC' },
          })
        : [];

    if (
      options.skipIfEmpty &&
      positions.length === 0 &&
      executions.length === 0
    ) {
      const globalConfig = await this.riskService.getGlobalConfig({
        manager,
        bypassCache: true,
      });
      if (!globalConfig.simAutoSnapshotEmptySession) {
        return null;
      }
    }

    const snapshotAt = new Date();
    const portfolio = await this.simulationService.getSnapshot(algoKind, manager);
    const globalConfig = await this.riskService.getGlobalConfig({
      manager,
      bypassCache: true,
    });

    const enrichedPositions = await this.presenter.enrich(positions, manager);
    const watchlistEntries = await manager.getRepository(WatchlistEntry).find();
    const { traders, tradersLabel } = buildSimTraderRollup(
      watchlistEntries,
      enrichedPositions,
    );

    const decisionPayload = await collectSimDecisionPayload(manager, {
      algoKind,
      snapshotAt,
      windowHours: globalConfig.simSnapshotDecisionWindowHours ?? 24,
      positions,
      watchlistEntries,
    });
    applyDecisionPayloadByteBudget(decisionPayload);

    const openPositionCount = decisionPayload.summary.openPositionCount;
    const closedPositionCount = decisionPayload.summary.closedPositionCount;

    const session = await this.sessionService.ensureActiveSession(
      algoKind,
      manager,
      portfolio.baselineCapital,
    );

    const row = manager.getRepository(SimulationStateSnapshot).create({
      label: options.label ?? null,
      source: options.source,
      sessionId: session.id,
      algoKind,
      amount: portfolio.amount,
      token: portfolio.token,
      positionsValue: portfolio.positionsValue,
      equity: portfolio.equity,
      openPnlSum: portfolio.openPnlSum,
      closedPnlSum: portfolio.closedPnlSum,
      baselineCapital: portfolio.baselineCapital,
      positionCount: positions.length,
      openPositionCount,
      closedPositionCount,
      executionCount: executions.length,
      traderCount: traders.length,
      tradersLabel,
      tradersJson: JSON.stringify(traders),
      positionsJson: JSON.stringify(enrichedPositions),
      executionsJson: JSON.stringify(executions),
      exitAttemptsJson: JSON.stringify(decisionPayload.exitAttempts),
      moveEventsJson: JSON.stringify(decisionPayload.moveEvents),
      decisionSummaryJson: JSON.stringify(decisionPayload.summary),
    });

    const saved = await manager.getRepository(SimulationStateSnapshot).save(row);
    await this.sessionService.recordSnapshotOnSession(
      manager,
      session.id,
      portfolio.equity,
    );
    return toSummary(saved, session.label);
  }

  async listSnapshots(
    options: ListSimSnapshotsOptions = {},
  ): Promise<{ items: SimStateSnapshotSummary[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const repo = this.ds.getRepository(SimulationStateSnapshot);
    const qb = repo.createQueryBuilder('s');

    if (options.algoKind) {
      qb.andWhere('s.algoKind = :algoKind', { algoKind: options.algoKind });
    }
    if (options.source) {
      qb.andWhere('s.source = :source', { source: options.source });
    }
    if (options.sessionId != null) {
      qb.andWhere('s.sessionId = :sessionId', { sessionId: options.sessionId });
    }
    const label = options.label?.trim();
    if (label) {
      qb.andWhere('LOWER(s.label) LIKE LOWER(:label)', { label: `%${label}%` });
    }
    if (options.from) {
      const from = new Date(options.from);
      from.setHours(0, 0, 0, 0);
      qb.andWhere('s.createdAt >= :from', { from });
    }
    if (options.to) {
      const to = new Date(options.to);
      to.setHours(23, 59, 59, 999);
      qb.andWhere('s.createdAt <= :to', { to });
    }

    qb.orderBy('s.createdAt', 'DESC').addOrderBy('s.id', 'DESC');

    const [rows, total] = await qb
      .select(SNAPSHOT_SUMMARY_COLUMNS)
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const sessionIds = [
      ...new Set(
        rows
          .map((r) => r.sessionId)
          .filter((id): id is number => id != null),
      ),
    ];
    const sessionLabels = new Map<number, string | null>();
    if (sessionIds.length > 0) {
      const sessions = await this.ds.getRepository(SimulationSession).find({
        where: { id: In(sessionIds) },
      });
      for (const s of sessions) {
        sessionLabels.set(s.id, s.label);
      }
    }

    return {
      items: rows.map((r) =>
        toSummary(r, r.sessionId != null ? sessionLabels.get(r.sessionId) ?? null : null),
      ),
      total,
    };
  }

  async getSnapshotDetail(id: number): Promise<SimStateSnapshotDetail | null> {
    const row = await this.ds
      .getRepository(SimulationStateSnapshot)
      .findOne({ where: { id } });
    if (!row) return null;

    const summary = toSummary(row);
    let sessionLabel: string | null = null;
    let sessionConfig: SimRiskConfigSnapshot | null = null;
    if (row.sessionId != null) {
      const session = await this.ds.getRepository(SimulationSession).findOne({
        where: { id: row.sessionId },
      });
      sessionLabel = session?.label ?? null;
      if (session?.configJson) {
        sessionConfig = safeParseJson(session.configJson, {} as SimRiskConfigSnapshot);
      }
    }
    return {
      ...toSummary(row, sessionLabel),
      config: sessionConfig,
      traders: safeParseJson(row.tradersJson, []),
      positions: safeParseJson<EnrichedCopiedPosition[]>(row.positionsJson, []),
      executions: safeParseJson<Execution[]>(row.executionsJson, []),
      exitAttempts: safeParseJson(row.exitAttemptsJson ?? '[]', []),
      moveEvents: safeParseJson(row.moveEventsJson ?? '[]', []),
      decisionSummary: row.decisionSummaryJson
        ? safeParseJson<SimSnapshotDecisionSummary | null>(
            row.decisionSummaryJson,
            null,
          )
        : null,
    };
  }

  async countSnapshots(): Promise<number> {
    return this.ds.getRepository(SimulationStateSnapshot).count();
  }

  async deleteAllSnapshots(): Promise<number> {
    const repo = this.ds.getRepository(SimulationStateSnapshot);
    const count = await repo.count();
    if (count === 0) return 0;

    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(SimulationStateSnapshot)
      .execute();
    return result.affected ?? count;
  }

  async deleteSnapshotsByAlgoKind(algoKind: SimAlgoKind): Promise<number> {
    const repo = this.ds.getRepository(SimulationStateSnapshot);
    const count = await repo.count({ where: { algoKind } });
    if (count === 0) return 0;

    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(SimulationStateSnapshot)
      .where('algo_kind = :algoKind', { algoKind })
      .execute();
    return result.affected ?? count;
  }

  /**
   * Prune snapshots based on retention policy.
   * - retentionDays: delete snapshots older than N days.
   * - maxCount: keep only the N most recent snapshots, delete the rest.
   * Returns total number of deleted rows.
   */
  async pruneSnapshots(opts: {
    retentionDays?: number | null;
    maxCount?: number | null;
  }): Promise<number> {
    const repo = this.ds.getRepository(SimulationStateSnapshot);
    let deleted = 0;

    if (opts.retentionDays != null && opts.retentionDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - opts.retentionDays);
      const result = await repo
        .createQueryBuilder()
        .delete()
        .from(SimulationStateSnapshot)
        .where('createdAt < :cutoff', { cutoff })
        .execute();
      deleted += result.affected ?? 0;
    }

    if (opts.maxCount != null && opts.maxCount > 0) {
      const total = await repo.count();
      if (total > opts.maxCount) {
        const toDelete = total - opts.maxCount;
        const ids = await repo
          .createQueryBuilder('s')
          .select('s.id')
          .orderBy('s.createdAt', 'DESC')
          .addOrderBy('s.id', 'DESC')
          .skip(opts.maxCount)
          .take(toDelete)
          .getMany();
        if (ids.length > 0) {
          const idValues = ids.map((r) => r.id);
          const result = await repo
            .createQueryBuilder()
            .delete()
            .from(SimulationStateSnapshot)
            .whereInIds(idValues)
            .execute();
          deleted += result.affected ?? 0;
        }
      }
    }

    return deleted;
  }
}
