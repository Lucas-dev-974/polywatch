import type { DataSource, EntityManager } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { RealSession } from '../entities/RealSession.js';
import { RealSessionState } from '../entities/RealSessionState.js';
import { RealStateSnapshot } from '../entities/RealStateSnapshot.js';
import { RiskService } from './risk.service.js';
import { RealPortfolioService } from './real-portfolio.service.js';
import {
  extractRealConfigSnapshot,
  type RealRiskConfigSnapshot,
} from '../risk/sim-mode-fields.js';
import type {
  ListRealSessionsOptions,
  RealSessionSummary,
  UpdateRealSessionOptions,
} from '../types/real-session.js';
import type { RealArchiveSummary } from '../types/real-session-archive.js';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function parseArchiveSummary(json: string | null): RealArchiveSummary | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RealArchiveSummary;
  } catch {
    return null;
  }
}

function parseConfigJson(json: string | null): RealRiskConfigSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RealRiskConfigSnapshot;
  } catch {
    return null;
  }
}

function toSummary(
  row: RealSession,
  liveEquity?: number | null,
): RealSessionSummary {
  const startedAt = toIso(row.startedAt)!;
  const endedAt = toIso(row.endedAt);
  const endMs = row.endedAt ? row.endedAt.getTime() : Date.now();
  const startMs = row.startedAt.getTime();
  const sessionPnl =
    row.status === 'closed'
      ? row.endingSessionPnl
      : liveEquity != null
        ? liveEquity - row.baselineCapital
        : row.endingSessionPnl;

  return {
    id: row.id,
    startedAt,
    endedAt,
    status: row.status,
    label: row.label,
    notes: row.notes,
    baselineCapital: row.baselineCapital,
    endingEquity: row.endingEquity,
    endingSessionPnl: row.endingSessionPnl,
    snapshotCount: row.snapshotCount,
    peakEquity: row.peakEquity,
    troughEquity: row.troughEquity,
    sessionPnl,
    durationMs: Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : null,
    archiveSummary: parseArchiveSummary(row.archiveSummaryJson),
    config: parseConfigJson(row.configJson),
  };
}

export class RealSessionService {
  private riskService: RiskService;
  private portfolioService: RealPortfolioService;

  constructor(private readonly ds: DataSource) {
    this.riskService = new RiskService(ds);
    this.portfolioService = new RealPortfolioService(ds);
  }

  /**
   * Stamp the current live config onto a session row.
   * Called at session creation and for in-place meta re-stamp.
   */
  async stampSessionConfig(
    manager: EntityManager,
    sessionId: number,
  ): Promise<void> {
    const riskConfig = await this.riskService.getConfig({
      manager,
      bypassCache: true,
    });
    const config = extractRealConfigSnapshot(riskConfig);
    await manager.getRepository(RealSession).update(sessionId, {
      configJson: JSON.stringify(config),
    });
  }

  /**
   * Create an initial snapshot for a newly created session.
   * Captures the starting portfolio state (clean slate).
   * Best-effort: if observedCash is not provided, skip silently.
   */
  private async createInitialSnapshot(
    manager: EntityManager,
    sessionId: number,
    observedCash?: number | null,
  ): Promise<void> {
    if (observedCash == null) return;
    const positions = await manager.getRepository(CopiedPosition).find({
      where: { mode: 'real' },
      order: { id: 'ASC' },
    });
    const executions = await manager.getRepository(Execution).find({
      where: { mode: 'real' },
      order: { executedAt: 'ASC', id: 'ASC' },
    });
    const portfolio = await this.portfolioService.getSnapshot(manager, observedCash);
    const snapshot = manager.getRepository(RealStateSnapshot).create({
      source: 'auto',
      sessionId,
      amount: portfolio.amount,
      token: 'USDC',
      positionsValue: portfolio.positionsValue,
      equity: portfolio.equity,
      openPnlSum: portfolio.openPnlSum,
      closedPnlSum: portfolio.closedPnlSum,
      baselineCapital: portfolio.baselineCapital,
      positionCount: positions.length,
      openPositionCount: 0,
      closedPositionCount: 0,
      executionCount: executions.length,
      traderCount: 0,
      tradersLabel: '',
      tradersJson: '[]',
      positionsJson: '[]',
      executionsJson: '[]',
      exitAttemptsJson: null,
      moveEventsJson: null,
      decisionSummaryJson: null,
    });
    await manager.getRepository(RealStateSnapshot).save(snapshot);
    await this.recordSnapshotOnSession(manager, sessionId, portfolio.equity);
  }

  async getActiveSession(
    manager?: EntityManager,
  ): Promise<RealSession | null> {
    const m = manager ?? this.ds.manager;
    return m.getRepository(RealSession).findOne({
      where: { status: 'active' },
      order: { id: 'DESC' },
    });
  }

  /**
   * Ensure an active session exists and is linked on RealSessionState.
   * Creates one lazily when missing (first snapshot / first API call).
   */
  async ensureActiveSession(
    manager: EntityManager,
    baselineCapital?: number,
    observedCash?: number | null,
  ): Promise<RealSession> {
    const stateRepo = manager.getRepository(RealSessionState);
    let state = await stateRepo.findOne({ where: { id: 1 } });
    if (!state) {
      const now = new Date();
      state = await stateRepo.save(
        stateRepo.create({
          id: 1,
          currentSessionId: null,
          periodStartedAt: now,
        }),
      );
    }

    if (state.currentSessionId != null) {
      const linked = await manager.getRepository(RealSession).findOne({
        where: { id: state.currentSessionId, status: 'active' },
      });
      if (linked) return linked;
    }

    const existing = await this.getActiveSession(manager);
    if (existing) {
      state.currentSessionId = existing.id;
      if (!state.periodStartedAt) {
        state.periodStartedAt = existing.startedAt;
      }
      await stateRepo.save(state);
      return existing;
    }

    const now = state.periodStartedAt ?? new Date();
    const baseline = baselineCapital ?? 0;
    const session = await manager.getRepository(RealSession).save(
      manager.getRepository(RealSession).create({
        startedAt: now,
        endedAt: null,
        status: 'active',
        label: null,
        notes: null,
        baselineCapital: baseline,
        endingEquity: null,
        endingSessionPnl: null,
        snapshotCount: 0,
        peakEquity: null,
        troughEquity: null,
        configJson: '{}',
      }),
    );
    // Stamp config on new session
    await this.stampSessionConfig(manager, session.id);
    // Initial snapshot for the new session
    await this.createInitialSnapshot(manager, session.id, observedCash);
    state.currentSessionId = session.id;
    state.periodStartedAt = now;
    await stateRepo.save(state);
    return session;
  }

  async recordSnapshotOnSession(
    manager: EntityManager,
    sessionId: number,
    equity: number,
  ): Promise<void> {
    const repo = manager.getRepository(RealSession);
    const session = await repo.findOne({ where: { id: sessionId } });
    if (!session) return;

    session.snapshotCount = (session.snapshotCount ?? 0) + 1;
    session.peakEquity =
      session.peakEquity == null
        ? equity
        : Math.max(session.peakEquity, equity);
    session.troughEquity =
      session.troughEquity == null
        ? equity
        : Math.min(session.troughEquity, equity);
    await repo.save(session);
  }

  /**
   * Close the active session (after period rotate), then open a new one.
   * Baseline for the new session = observed equity at rotate time.
   */
  async rotateAfterClose(
    manager: EntityManager,
    options: {
      endingEquity: number;
      endingSessionPnl: number;
      newBaselineCapital: number;
      periodStartedAt: Date;
      newSessionLabel?: string | null;
      observedCash?: number | null;
    },
  ): Promise<{ closed: RealSession | null; opened: RealSession }> {
    const sessionRepo = manager.getRepository(RealSession);
    const stateRepo = manager.getRepository(RealSessionState);
    const active = await this.getActiveSession(manager);

    if (active) {
      active.status = 'closed';
      active.endedAt = options.periodStartedAt;
      active.endingEquity = options.endingEquity;
      active.endingSessionPnl = options.endingSessionPnl;
      await sessionRepo.save(active);
    }

    const opened = await sessionRepo.save(
      sessionRepo.create({
        startedAt: options.periodStartedAt,
        endedAt: null,
        status: 'active',
        label: options.newSessionLabel ?? null,
        notes: null,
        baselineCapital: options.newBaselineCapital,
        endingEquity: null,
        endingSessionPnl: null,
        snapshotCount: 0,
        peakEquity: null,
        troughEquity: null,
        configJson: '{}',
      }),
    );
    // Stamp config on new session
    await this.stampSessionConfig(manager, opened.id);
    // Initial snapshot for the new session
    await this.createInitialSnapshot(manager, opened.id, options.observedCash);

    let state = await stateRepo.findOne({ where: { id: 1 } });
    if (!state) {
      state = stateRepo.create({ id: 1 });
    }
    state.currentSessionId = opened.id;
    state.periodStartedAt = options.periodStartedAt;
    await stateRepo.save(state);

    return { closed: active, opened };
  }

  async listSessions(
    options: ListRealSessionsOptions = {},
  ): Promise<{ items: RealSessionSummary[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const qb = this.ds.getRepository(RealSession).createQueryBuilder('s');

    if (options.status) {
      qb.andWhere('s.status = :status', { status: options.status });
    }
    const label = options.label?.trim();
    if (label) {
      qb.andWhere('LOWER(s.label) LIKE LOWER(:label)', {
        label: `%${label}%`,
      });
    }
    if (options.from) {
      const from = new Date(options.from);
      from.setHours(0, 0, 0, 0);
      qb.andWhere('s.startedAt >= :from', { from });
    }
    if (options.to) {
      const to = new Date(options.to);
      to.setHours(23, 59, 59, 999);
      qb.andWhere('s.startedAt <= :to', { to });
    }

    qb.orderBy('s.startedAt', 'DESC').addOrderBy('s.id', 'DESC');

    const [rows, total] = await qb.skip(offset).take(limit).getManyAndCount();

    return {
      items: rows.map((r) => toSummary(r)),
      total,
    };
  }

  async getSession(
    id: number,
    liveEquity?: number | null,
  ): Promise<RealSessionSummary | null> {
    const row = await this.ds.getRepository(RealSession).findOne({
      where: { id },
    });
    if (!row) return null;
    return toSummary(
      row,
      row.status === 'active' ? liveEquity ?? null : null,
    );
  }

  async getCurrentSession(
    liveEquity?: number | null,
  ): Promise<RealSessionSummary | null> {
    const active = await this.ds.transaction(async (manager) =>
      this.ensureActiveSession(manager),
    );
    return toSummary(active, liveEquity ?? null);
  }

  async updateSession(
    id: number,
    patch: UpdateRealSessionOptions,
  ): Promise<RealSessionSummary | null> {
    const repo = this.ds.getRepository(RealSession);
    const row = await repo.findOne({ where: { id } });
    if (!row) return null;
    if (patch.label !== undefined) row.label = patch.label;
    if (patch.notes !== undefined) row.notes = patch.notes;
    await repo.save(row);
    return toSummary(row);
  }

  async deleteSession(
    id: number,
    options?: { deleteSnapshots?: boolean },
  ): Promise<{ deleted: boolean; snapshotsDeleted: number }> {
    const session = await this.ds
      .getRepository(RealSession)
      .findOne({ where: { id } });
    if (!session) return { deleted: false, snapshotsDeleted: 0 };
    if (session.status === 'active') {
      throw new Error('cannot_delete_active_session');
    }

    let snapshotsDeleted = 0;
    await this.ds.transaction(async (manager) => {
      if (options?.deleteSnapshots) {
        const result = await manager
          .getRepository(RealStateSnapshot)
          .createQueryBuilder()
          .delete()
          .where('session_id = :id', { id })
          .execute();
        snapshotsDeleted = result.affected ?? 0;
      } else {
        await manager
          .getRepository(RealStateSnapshot)
          .createQueryBuilder()
          .update()
          .set({ sessionId: null })
          .where('session_id = :id', { id })
          .execute();
      }
      await manager.getRepository(RealSession).delete(id);
    });

    return { deleted: true, snapshotsDeleted };
  }

  /**
   * Delete all closed sessions and their associated snapshots in one transaction.
   * Active sessions are never touched.
   * Returns the number of sessions deleted and snapshots removed.
   */
  async deleteAllClosedSessions(): Promise<{
    sessionsDeleted: number;
    snapshotsDeleted: number;
  }> {
    return this.ds.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(RealSession);
      const snapshotRepo = manager.getRepository(RealStateSnapshot);

      // Find all closed session IDs
      const closedSessions = await sessionRepo.find({
        where: { status: 'closed' as const },
        select: ['id'],
      });
      if (closedSessions.length === 0) {
        return { sessionsDeleted: 0, snapshotsDeleted: 0 };
      }
      const ids = closedSessions.map((s) => s.id);

      // Delete snapshots for those sessions
      const snapshotResult = await snapshotRepo
        .createQueryBuilder()
        .delete()
        .where('session_id IN (:...ids)', { ids })
        .execute();
      const snapshotsDeleted = snapshotResult.affected ?? 0;

      // Delete the sessions
      const sessionResult = await sessionRepo
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids })
        .execute();
      const sessionsDeleted = sessionResult.affected ?? 0;

      return { sessionsDeleted, snapshotsDeleted };
    });
  }
}
