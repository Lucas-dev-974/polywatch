import type { DataSource, EntityManager } from 'typeorm';
import {
  RiskService,
  SimulationArchiveService,
  SimulationSessionService,
  SimulationService,
  SimulationResetArchiveService,
  RealArchiveService,
  RealSessionService,
  RealPortfolioService,
  RealPeriodArchiveService,
  extractSimConfigSnapshot,
  extractRealConfigSnapshot,
  simRotationChanged,
  realRotationChanged,
  collectSimRedisPurgeHints,
  purgeSimExecutionRedisState,
  publishSimulationReset,
  withRealRotateLock,
  SimulationBalance,
} from '@polywatch/core';
import type { RiskConfig } from '@polywatch/core';
import { fetchObservedWalletCash } from '../polymarket/observed-wallet-cash.js';
import { getRedis } from '../redis.js';
import { emitSimulationReset, emitRealPeriodRotated } from '../websocket.js';
import { emitSimSnapshot } from '../notify/simulation.js';
import { recordSnapshotCreated, recordSnapshotCount } from '../metrics.js';

export interface SimRotationResult {
  closedId: number | null;
  openedId: number;
}

export interface RealRotationResult {
  closedId: number | null;
  openedId: number;
}

export interface RotationResult {
  sim?: SimRotationResult | null;
  real?: RealRotationResult | null;
}

export class SessionRotationService {
  private riskService: RiskService;
  private simArchiveService: SimulationArchiveService;
  private simSessionService: SimulationSessionService;
  private simService: SimulationService;
  private resetArchiveService: SimulationResetArchiveService;
  private realArchiveService: RealArchiveService;
  private realSessionService: RealSessionService;
  private realPortfolioService: RealPortfolioService;
  private realPeriodArchiveService: RealPeriodArchiveService;

  constructor(private readonly ds: DataSource) {
    this.riskService = new RiskService(ds);
    this.simArchiveService = new SimulationArchiveService(ds);
    this.simSessionService = new SimulationSessionService(ds);
    this.simService = new SimulationService(ds);
    this.resetArchiveService = new SimulationResetArchiveService(ds);
    this.realArchiveService = new RealArchiveService(ds);
    this.realSessionService = new RealSessionService(ds);
    this.realPortfolioService = new RealPortfolioService(ds);
    this.realPeriodArchiveService = new RealPeriodArchiveService(ds);
  }

  /**
   * Called after PUT /risk-config succeeds.
   * Compares rotation keys before/after and triggers rotations as needed.
   * Returns null for a mode when no rotation was needed.
   */
  async rotateOnConfigChange(
    before: RiskConfig,
    after: RiskConfig,
  ): Promise<RotationResult> {
    const result: RotationResult = {};

    // Sim rotation
    if (simRotationChanged(before, after)) {
      result.sim = await this.performSimHardRotate(after);
    }

    // Real rotation
    if (realRotationChanged(before, after)) {
      result.real = await this.performRealSoftRotate(after);
    }

    return result;
  }

  /**
   * Hard rotate sim: snapshot close, archive, wipe, new session.
   * Uses archive:true, deepClean:false, source:config_change.
   */
  private async performSimHardRotate(
    after: RiskConfig,
  ): Promise<SimRotationResult | null> {
    const activeSession = await this.simSessionService.getActiveSession();
    if (!activeSession) {
      // No active session — create one stamped with current config
      const opened = await this.ds.transaction(async (manager) => {
        const session = await this.simSessionService.ensureActiveSession(manager);
        await this.simSessionService.stampSessionConfig(manager, session.id);
        return session;
      });
      return { closedId: null, openedId: opened.id };
    }

    const before = await this.simService.getSnapshot();
    const amount = activeSession.baselineCapital;

    // Pre-close snapshot
    const closeSnapshot = await this.simArchiveService.createSnapshot({
      source: 'config_change' as any,
      label: 'Avant changement de config',
      skipIfEmpty: true,
    });
    if (closeSnapshot) {
      recordSnapshotCreated('config_change', 'sim');
    }

    const endingEquity = closeSnapshot?.equity ?? before.equity;
    const endingSessionPnl =
      closeSnapshot?.sessionPnl ?? before.equity - before.baselineCapital;

    const redisPurgeHints = await collectSimRedisPurgeHints(this.ds);

    await this.ds.transaction(async (manager) => {
      const session = await this.simSessionService.ensureActiveSession(manager);
      await this.resetArchiveService.archiveSession(manager, session);
      await this.simService.resetWithManager(manager, amount);
      const balance = await manager
        .getRepository(SimulationBalance)
        .findOne({ where: {} });
      const sessionStartedAt = balance?.sessionStartedAt ?? new Date();
      await this.simSessionService.rotateAfterReset(manager, {
        endingEquity,
        endingSessionPnl,
        newBaselineCapital: amount,
        sessionStartedAt,
        newSessionLabel: null,
      });
    });
    RiskService.invalidateConfigCache();

    await purgeSimExecutionRedisState(getRedis(), redisPurgeHints);

    const balanceRow = await this.ds
      .getRepository(SimulationBalance)
      .findOne({ where: {} });

    emitSimulationReset();
    const snapshot = await this.simService.getSnapshot();
    emitSimSnapshot(snapshot);
    await publishSimulationReset(getRedis(), {
      sessionStartedAt: balanceRow?.sessionStartedAt?.toISOString(),
    });

    return {
      closedId: activeSession.id,
      openedId: (await this.simSessionService.getActiveSession())!.id,
    };
  }

  /**
   * Soft rotate real: close period, open new, stamp config.
   * Snapshot is best-effort (skip if wallet unavailable).
   */
  private async performRealSoftRotate(
    after: RiskConfig,
  ): Promise<RealRotationResult | null> {
    const activeSession = await this.realSessionService.getActiveSession();
    if (!activeSession) {
      // No active session — create one stamped with current config
      const opened = await this.ds.transaction(async (manager) => {
        const session = await this.realSessionService.ensureActiveSession(manager);
        await this.realSessionService.stampSessionConfig(manager, session.id);
        return session;
      });
      return { closedId: null, openedId: opened.id };
    }

    // Try to get portfolio for ending equity (best-effort)
    let endingEquity = activeSession.baselineCapital;
    let endingSessionPnl = 0;

    const observedCash = await fetchObservedWalletCash(this.ds);

    if (observedCash != null) {
      try {
        const portfolio = await this.realPortfolioService.getSnapshot(
          this.ds.manager,
          observedCash,
        );
        endingEquity = portfolio.equity;
        endingSessionPnl = portfolio.equity - portfolio.baselineCapital;
      } catch {
        // Use baseline as fallback
      }
    }

    // Pre-rotate snapshot (best-effort)
    if (observedCash != null) {
      try {
        const snap = await this.realArchiveService.createSnapshot({
          source: 'config_change' as any,
          label: 'Avant changement de config',
          observedCash,
          skipIfEmpty: true,
        });
        if (snap) {
          recordSnapshotCreated('config_change', 'real');
        }
      } catch {
        // Best-effort snapshot
      }
    }

    try {
      await withRealRotateLock(this.ds, async (manager) => {
        const session = await this.realSessionService.ensureActiveSession(manager);
        const rotateAt = new Date();

        try {
          await this.realPeriodArchiveService.archiveClosedInWindow(
            manager,
            session,
            rotateAt,
          );
        } catch {
          // Archive best-effort
        }

        await this.realSessionService.rotateAfterClose(manager, {
          endingEquity,
          endingSessionPnl,
          newBaselineCapital: activeSession.baselineCapital,
          periodStartedAt: rotateAt,
          newSessionLabel: null,
          observedCash,
        });
      });
    } catch (err) {
      // If rotate lock fails, still try to stamp the active session
      await this.ds.transaction(async (manager) => {
        await this.realSessionService.stampSessionConfig(manager, activeSession.id);
      });
    }

    emitRealPeriodRotated();

    return {
      closedId: activeSession.id,
      openedId: (await this.realSessionService.getActiveSession())!.id,
    };
  }
}
