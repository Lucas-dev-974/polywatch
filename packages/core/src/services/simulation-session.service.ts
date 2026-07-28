import type { DataSource, EntityManager } from 'typeorm';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { SimulationSession } from '../entities/SimulationSession.js';
import { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';
import { RiskService } from './risk.service.js';
import {
  extractSimConfigSnapshot,
  type SimRiskConfigSnapshot,
} from '../risk/sim-mode-fields.js';
import type {
  ListSimSessionsOptions,
  SimSessionSummary,
  UpdateSimSessionOptions,
} from '../types/sim-session.js';
import type { SimArchiveSummary } from '../types/sim-session-archive.js';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function parseArchiveSummary(json: string | null): SimArchiveSummary | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as SimArchiveSummary;
  } catch {
    return null;
  }
}

function parseConfigJson(json: string | null): SimRiskConfigSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as SimRiskConfigSnapshot;
  } catch {
    return null;
  }
}

function toSummary(
  row: SimulationSession,
  liveEquity?: number | null,
): SimSessionSummary {
  const startedAt = toIso(row.startedAt)!;
  const endedAt = toIso(row.endedAt);
  const endMs = row.endedAt
    ? row.endedAt.getTime()
    : Date.now();
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

export class SimulationSessionService {
  private riskService: RiskService;

  constructor(private readonly ds: DataSource) {
    this.riskService = new RiskService(ds);
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
    const config = extractSimConfigSnapshot(riskConfig);
    await manager.getRepository(SimulationSession).update(sessionId, {
      configJson: JSON.stringify(config),
    });
  }

  /**
   * Create an initial snapshot for a newly created session.
   * Captures the starting portfolio state (clean slate).
   */
  private async createInitialSnapshot(
    manager: EntityManager,
    sessionId: number,
  ): Promise<void> {
    const balance = await manager.getRepository(SimulationBalance).findOne({ where: { algoKind: 'crypto' } });
    const amount = balance?.amount ?? 0;
    const baselineCapital = balance?.baselineCapital ?? amount;
    const snapshot = manager.getRepository(SimulationStateSnapshot).create({
      source: 'auto',
      sessionId,
      amount,
      token: 'pUSD',
      positionsValue: 0,
      equity: amount,
      openPnlSum: 0,
      closedPnlSum: 0,
      baselineCapital,
      positionCount: 0,
      openPositionCount: 0,
      closedPositionCount: 0,
      executionCount: 0,
      traderCount: 0,
      tradersLabel: '',
      tradersJson: '[]',
      positionsJson: '[]',
      executionsJson: '[]',
      exitAttemptsJson: null,
      moveEventsJson: null,
      decisionSummaryJson: null,
    });
    await manager.getRepository(SimulationStateSnapshot).save(snapshot);
    await this.recordSnapshotOnSession(manager, sessionId, amount);
  }

  async getActiveSession(
    manager?: EntityManager,
  ): Promise<SimulationSession | null> {
    const m = manager ?? this.ds.manager;
    return m.getRepository(SimulationSession).findOne({
      where: { status: 'active' },
      order: { id: 'DESC' },
    });
  }

  /**
   * Ensure an active session exists and is linked on SimulationBalance.
   * Creates one lazily when missing (first snapshot / first API call).
   */
  async ensureActiveSession(
    manager: EntityManager,
    baselineCapital?: number,
  ): Promise<SimulationSession> {
    const balanceRepo = manager.getRepository(SimulationBalance);
    let balance = await balanceRepo.findOne({ where: { algoKind: 'crypto' } });
    if (!balance) {
      const baseline = baselineCapital ?? DEFAULT_SIM_BALANCE;
      const now = new Date();
      balance = await balanceRepo.save(
        balanceRepo.create({
          algoKind: 'crypto',
          token: 'pUSD',
          amount: baseline,
          baselineCapital: baseline,
          sessionStartedAt: now,
        }),
      );
    }

    if (balance.currentSessionId != null) {
      const linked = await manager.getRepository(SimulationSession).findOne({
        where: { id: balance.currentSessionId, status: 'active' },
      });
      if (linked) return linked;
    }

    const existing = await this.getActiveSession(manager);
    if (existing) {
      balance.currentSessionId = existing.id;
      if (!balance.sessionStartedAt) {
        balance.sessionStartedAt = existing.startedAt;
      }
      await balanceRepo.save(balance);
      return existing;
    }

    const now = balance.sessionStartedAt ?? new Date();
    const baseline =
      baselineCapital ??
      balance.baselineCapital ??
      balance.amount ??
      DEFAULT_SIM_BALANCE;
    const session = await manager.getRepository(SimulationSession).save(
      manager.getRepository(SimulationSession).create({
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
    await this.createInitialSnapshot(manager, session.id);
    balance.currentSessionId = session.id;
    balance.sessionStartedAt = now;
    await balanceRepo.save(balance);
    return session;
  }

  async recordSnapshotOnSession(
    manager: EntityManager,
    sessionId: number,
    equity: number,
  ): Promise<void> {
    const repo = manager.getRepository(SimulationSession);
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
   * Close the active session (after reset snapshot), then open a new one.
   * Call after wipe so the new session aligns with the fresh baseline.
   */
  async rotateAfterReset(
    manager: EntityManager,
    options: {
      endingEquity: number;
      endingSessionPnl: number;
      newBaselineCapital: number;
      sessionStartedAt: Date;
      newSessionLabel?: string | null;
    },
  ): Promise<{ closed: SimulationSession | null; opened: SimulationSession }> {
    const sessionRepo = manager.getRepository(SimulationSession);
    const balanceRepo = manager.getRepository(SimulationBalance);
    const active = await this.getActiveSession(manager);

    if (active) {
      active.status = 'closed';
      active.endedAt = options.sessionStartedAt;
      active.endingEquity = options.endingEquity;
      active.endingSessionPnl = options.endingSessionPnl;
      await sessionRepo.save(active);
    }

    const opened = await sessionRepo.save(
      sessionRepo.create({
        startedAt: options.sessionStartedAt,
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
    await this.createInitialSnapshot(manager, opened.id);

    const balance = await balanceRepo.findOne({ where: { algoKind: 'crypto' } });
    if (balance) {
      balance.currentSessionId = opened.id;
      balance.sessionStartedAt = options.sessionStartedAt;
      await balanceRepo.save(balance);
    }

    return { closed: active, opened };
  }

  async listSessions(
    options: ListSimSessionsOptions = {},
  ): Promise<{ items: SimSessionSummary[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const qb = this.ds
      .getRepository(SimulationSession)
      .createQueryBuilder('s');

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

    let liveEquity: number | null = null;
    if (rows.some((r) => r.status === 'active')) {
      const balance = await this.ds
        .getRepository(SimulationBalance)
        .findOne({ where: {} });
      // Approximate live equity as cash only here; callers can enrich via getSnapshot.
      liveEquity = balance?.amount ?? null;
    }

    return {
      items: rows.map((r) => toSummary(r, r.status === 'active' ? liveEquity : null)),
      total,
    };
  }

  async getSession(
    id: number,
    liveEquity?: number | null,
  ): Promise<SimSessionSummary | null> {
    const row = await this.ds
      .getRepository(SimulationSession)
      .findOne({ where: { id } });
    if (!row) return null;
    return toSummary(
      row,
      row.status === 'active' ? liveEquity ?? null : null,
    );
  }

  async getCurrentSession(
    liveEquity?: number | null,
  ): Promise<SimSessionSummary | null> {
    const active = await this.ds.transaction(async (manager) =>
      this.ensureActiveSession(manager),
    );
    return toSummary(active, liveEquity ?? null);
  }

  async updateSession(
    id: number,
    patch: UpdateSimSessionOptions,
  ): Promise<SimSessionSummary | null> {
    const repo = this.ds.getRepository(SimulationSession);
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
      .getRepository(SimulationSession)
      .findOne({ where: { id } });
    if (!session) return { deleted: false, snapshotsDeleted: 0 };
    if (session.status === 'active') {
      throw new Error('cannot_delete_active_session');
    }

    let snapshotsDeleted = 0;
    await this.ds.transaction(async (manager) => {
      if (options?.deleteSnapshots) {
        const result = await manager
          .getRepository(SimulationStateSnapshot)
          .createQueryBuilder()
          .delete()
          .where('session_id = :id', { id })
          .execute();
        snapshotsDeleted = result.affected ?? 0;
      } else {
        await manager
          .getRepository(SimulationStateSnapshot)
          .createQueryBuilder()
          .update()
          .set({ sessionId: null })
          .where('session_id = :id', { id })
          .execute();
      }
      await manager.getRepository(SimulationSession).delete(id);
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
      const sessionRepo = manager.getRepository(SimulationSession);
      const snapshotRepo = manager.getRepository(SimulationStateSnapshot);

      const closedSessions = await sessionRepo.find({
        where: { status: 'closed' as const },
        select: ['id'],
      });
      if (closedSessions.length === 0) {
        return { sessionsDeleted: 0, snapshotsDeleted: 0 };
      }
      const ids = closedSessions.map((s) => s.id);

      const snapshotResult = await snapshotRepo
        .createQueryBuilder()
        .delete()
        .where('session_id IN (:...ids)', { ids })
        .execute();
      const snapshotsDeleted = snapshotResult.affected ?? 0;

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
