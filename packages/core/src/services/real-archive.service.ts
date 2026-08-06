import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { RealStateSnapshot } from '../entities/RealStateSnapshot.js';
import { RealSession } from '../entities/RealSession.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { RealSessionService } from './real-session.service.js';
import type { RealRiskConfigSnapshot } from '../risk/sim-mode-fields.js';
import { withRealAutoSnapshotCreationLock } from '../real/real-rotate-lock.js';
import {
  isAutoSnapshotDueByAge,
  MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
} from '../simulation/auto-snapshot-timing.js';
import { buildRealTraderRollup } from '../real/trader-rollup.js';
import {
  collectRealDecisionPayload,
  estimateRealDecisionPayloadBytes,
  SNAPSHOT_DECISION_MAX_EVENTS,
  SNAPSHOT_DECISION_MAX_JSON_BYTES,
  type RealSnapshotDecisionSummary,
} from '../real/snapshot-decision-collector.js';
import {
  CopiedPositionPresenter,
  type EnrichedCopiedPosition,
} from './copied-position-presenter.js';
import { RiskService } from './risk.service.js';
import { RealPortfolioService } from './real-portfolio.service.js';
import {
  type CreateRealStateSnapshotOptions,
  type ListRealSnapshotsOptions,
  type RealStateSnapshotDetail,
  type RealStateSnapshotSummary,
  safeParseJson,
} from '../types/real-state-snapshot.js';

function toSummary(
  row: RealStateSnapshot,
  sessionLabel: string | null = null,
): RealStateSnapshotSummary {
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

const SNAPSHOT_SUMMARY_COLUMNS: string[] = [
  's.id', 's.createdAt', 's.label', 's.source', 's.sessionId',
  's.amount', 's.token', 's.positionsValue', 's.equity',
  's.openPnlSum', 's.closedPnlSum', 's.baselineCapital',
  's.positionCount', 's.openPositionCount', 's.closedPositionCount',
  's.executionCount', 's.traderCount', 's.tradersLabel',
];

export class RealArchiveService {
  private portfolioService: RealPortfolioService;
  private riskService: RiskService;
  private presenter: CopiedPositionPresenter;
  private sessionService: RealSessionService;

  constructor(private readonly ds: DataSource) {
    this.portfolioService = new RealPortfolioService(ds);
    this.riskService = new RiskService(ds);
    this.presenter = new CopiedPositionPresenter(ds);
    this.sessionService = new RealSessionService(ds);
  }

  async hasRealActivity(): Promise<boolean> {
    const positionCount = await this.ds.getRepository(CopiedPosition).count({
      where: { mode: 'real' },
    });
    if (positionCount > 0) return true;
    const executionCount = await this.ds.getRepository(Execution).count({
      where: { mode: 'real' },
    });
    return executionCount > 0;
  }

  async createSnapshot(
    options: CreateRealStateSnapshotOptions,
  ): Promise<RealStateSnapshotSummary | null> {
    return this.ds.transaction(async (manager) =>
      this.persistSnapshot(manager, options),
    );
  }

  async createAutoSnapshotIfDue(options: {
    intervalSec: number;
    minIntervalSec?: number;
    label?: string | null;
    observedCash: number;
  }): Promise<RealStateSnapshotSummary | null> {
    const minIntervalSec =
      options.minIntervalSec ?? MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS;

    const ageSeconds = await this.lastAutoSnapshotAgeSeconds(this.ds.manager);
    if (!isAutoSnapshotDueByAge(options.intervalSec, ageSeconds, minIntervalSec)) {
      return null;
    }

    return withRealAutoSnapshotCreationLock(this.ds, async (manager) => {
      const lockedAgeSeconds = await this.lastAutoSnapshotAgeSeconds(manager);
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
        source: 'auto',
        label: options.label ?? 'Automatique',
        observedCash: options.observedCash,
        skipIfEmpty: true,
      });
    });
  }

  private async lastAutoSnapshotAgeSeconds(
    manager: EntityManager,
  ): Promise<number | null> {
    const isPostgres = this.ds.options.type === 'postgres';
    const sql = isPostgres
      ? `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS age
         FROM real_state_snapshots
         WHERE source = 'auto'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      : `SELECT (julianday('now') - julianday(created_at)) * 86400 AS age
         FROM real_state_snapshots
         WHERE source = 'auto'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`;
    const rows = (await manager.query(sql)) as Array<{ age: number | string }>;
    if (!rows || rows.length === 0) return null;
    const age = Number(rows[0].age);
    return Number.isFinite(age) ? age : null;
  }

  private async persistSnapshot(
    manager: EntityManager,
    options: CreateRealStateSnapshotOptions,
  ): Promise<RealStateSnapshotSummary | null> {
    const positions = await manager.getRepository(CopiedPosition).find({
      where: { mode: 'real' },
      order: { id: 'ASC' },
    });
    const executions = await manager.getRepository(Execution).find({
      where: { mode: 'real' },
      order: { executedAt: 'ASC', id: 'ASC' },
    });

    if (
      options.skipIfEmpty &&
      positions.length === 0 &&
      executions.length === 0
    ) {
      return null;
    }

    const snapshotAt = new Date();
    const portfolio = await this.portfolioService.getSnapshot(
      manager,
      options.observedCash,
    );
    const globalConfig = await this.riskService.getGlobalConfig({
      manager,
      bypassCache: true,
    });

    const enrichedPositions = await this.presenter.enrich(positions, manager);
    const watchlistEntries = await manager.getRepository(WatchlistEntry).find();
    const { traders, tradersLabel } = buildRealTraderRollup(
      watchlistEntries,
      enrichedPositions,
    );

    const decisionPayload = await collectRealDecisionPayload(manager, {
      snapshotAt,
      windowHours: globalConfig.realSnapshotDecisionWindowHours ?? 24,
      positions,
      watchlistEntries,
    });
    if (
      estimateRealDecisionPayloadBytes(decisionPayload) >
      SNAPSHOT_DECISION_MAX_JSON_BYTES
    ) {
      decisionPayload.summary.truncated = true;
      const half = Math.floor(SNAPSHOT_DECISION_MAX_EVENTS / 2);
      decisionPayload.exitAttempts = decisionPayload.exitAttempts.slice(-half);
      decisionPayload.moveEvents = decisionPayload.moveEvents.slice(-half);
    }

    const openPositionCount = decisionPayload.summary.openPositionCount;
    const closedPositionCount = decisionPayload.summary.closedPositionCount;

    const session = await this.sessionService.ensureActiveSession(
      manager,
      portfolio.baselineCapital,
    );

    const row = manager.getRepository(RealStateSnapshot).create({
      label: options.label ?? null,
      source: options.source,
      sessionId: session.id,
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

    const saved = await manager.getRepository(RealStateSnapshot).save(row);
    await this.sessionService.recordSnapshotOnSession(
      manager,
      session.id,
      portfolio.equity,
    );
    return toSummary(saved, session.label);
  }

  async listSnapshots(
    options: ListRealSnapshotsOptions = {},
  ): Promise<{ items: RealStateSnapshotSummary[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const repo = this.ds.getRepository(RealStateSnapshot);
    const qb = repo.createQueryBuilder('s');

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
      const sessions = await this.ds.getRepository(RealSession).find({
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

  async getSnapshotDetail(id: number): Promise<RealStateSnapshotDetail | null> {
    const row = await this.ds
      .getRepository(RealStateSnapshot)
      .findOne({ where: { id } });
    if (!row) return null;

    let sessionLabel: string | null = null;
    let sessionConfig: RealRiskConfigSnapshot | null = null;
    if (row.sessionId != null) {
      const session = await this.ds.getRepository(RealSession).findOne({
        where: { id: row.sessionId },
      });
      sessionLabel = session?.label ?? null;
      if (session?.configJson) {
        sessionConfig = safeParseJson(session.configJson, {} as RealRiskConfigSnapshot);
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
        ? safeParseJson<RealSnapshotDecisionSummary | null>(
            row.decisionSummaryJson,
            null,
          )
        : null,
    };
  }

  async countSnapshots(): Promise<number> {
    return this.ds.getRepository(RealStateSnapshot).count();
  }

  async deleteAllSnapshots(): Promise<number> {
    const repo = this.ds.getRepository(RealStateSnapshot);
    const count = await repo.count();
    if (count === 0) return 0;

    const result = await repo
      .createQueryBuilder()
      .delete()
      .from(RealStateSnapshot)
      .execute();
    return result.affected ?? count;
  }

  async pruneSnapshots(opts: {
    retentionDays?: number | null;
    maxCount?: number | null;
  }): Promise<number> {
    const repo = this.ds.getRepository(RealStateSnapshot);
    let deleted = 0;

    if (opts.retentionDays != null && opts.retentionDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - opts.retentionDays);
      const result = await repo
        .createQueryBuilder()
        .delete()
        .from(RealStateSnapshot)
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
            .from(RealStateSnapshot)
            .whereInIds(idValues)
            .execute();
          deleted += result.affected ?? 0;
        }
      }
    }

    return deleted;
  }
}
