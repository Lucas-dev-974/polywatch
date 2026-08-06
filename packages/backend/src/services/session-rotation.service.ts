import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
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
  realRotationChangedFromIsolated,
  resolveSimRotationTargetsFromConfigs,
  collectSimRedisPurgeHints,
  purgeSimExecutionRedisState,
  publishSimulationReset,
  withRealRotateLock,
  SimulationBalance,
  CopiedPosition,
  getSimInitialCapital,
  algoKindFromReason,
  type SimAlgoKind,
  type GlobalConfig,
  type CopyConfig,
  type CryptoConfig,
  type WeatherConfig,
} from '@polywatch/core';
import { fetchObservedWalletCash } from '../polymarket/observed-wallet-cash.js';
import { getRedis } from '../redis.js';
import { emitSimulationReset, emitRealPeriodRotated } from '../websocket.js';
import { broadcastSimSnapshot } from '../notify/simulation.js';
import { recordSnapshotCreated, recordSnapshotCount } from '../metrics.js';

export type IsolatedConfigBundle = {
  global: GlobalConfig;
  copy: CopyConfig;
  crypto: CryptoConfig;
  weather: WeatherConfig;
};

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
  private simArchiveService: SimulationArchiveService;
  private simSessionService: SimulationSessionService;
  private simService: SimulationService;
  private resetArchiveService: SimulationResetArchiveService;
  private realArchiveService: RealArchiveService;
  private realSessionService: RealSessionService;
  private realPortfolioService: RealPortfolioService;
  private realPeriodArchiveService: RealPeriodArchiveService;

  constructor(private readonly ds: DataSource) {
    this.simArchiveService = new SimulationArchiveService(ds);
    this.simSessionService = new SimulationSessionService(ds);
    this.simService = new SimulationService(ds);
    this.resetArchiveService = new SimulationResetArchiveService(ds);
    this.realArchiveService = new RealArchiveService(ds);
    this.realSessionService = new RealSessionService(ds);
    this.realPortfolioService = new RealPortfolioService(ds);
    this.realPeriodArchiveService = new RealPeriodArchiveService(ds);
  }

  async rotateOnConfigChange(
    before: IsolatedConfigBundle,
    after: IsolatedConfigBundle,
  ): Promise<RotationResult> {
    const result: RotationResult = {};

    const simTargets = resolveSimRotationTargetsFromConfigs(before, after);

    if (simTargets.length > 0) {
      result.sim = await this.performSimHardRotate(after, simTargets);
    }

    if (realRotationChangedFromIsolated(before, after)) {
      result.real = await this.performRealSoftRotate();
    }

    return result;
  }

  private async performSimHardRotate(
    after: IsolatedConfigBundle,
    targets: SimAlgoKind[],
  ): Promise<SimRotationResult | null> {
    let lastClosedId: number | null = null;
    let lastOpenedId: number | null = null;

    const capitalSource = {
      simInitialCapitalCrypto: after.crypto.simInitialCapitalCrypto,
      simInitialCapitalWeather: after.weather.simInitialCapitalWeather,
      simInitialCapitalCopy: after.copy.simInitialCapitalCopy,
    };

    for (const algoKind of targets) {
      const activeSession = await this.simSessionService.getActiveSession(algoKind);
      if (!activeSession) {
        const opened = await this.ds.transaction(async (manager) => {
          const session = await this.simSessionService.ensureActiveSession(
            algoKind,
            manager,
          );
          await this.simSessionService.stampSessionConfig(manager, session.id);
          return session;
        });
        lastOpenedId = opened.id;
        continue;
      }

      const beforeSnap = await this.simService.getSnapshot(algoKind);
      const amount = getSimInitialCapital(capitalSource, algoKind);

      const closeSnapshot = await this.simArchiveService.createSnapshot({
        algoKind,
        source: 'config_change' as never,
        label: 'Avant changement de config',
        skipIfEmpty: true,
      });
      if (closeSnapshot) {
        recordSnapshotCreated('config_change', 'sim');
      }

      const endingEquity = closeSnapshot?.equity ?? beforeSnap.equity;
      const endingSessionPnl =
        closeSnapshot?.sessionPnl ??
        beforeSnap.equity - beforeSnap.baselineCapital;

      const redisPurgeHints = await collectSimRedisPurgeHints(this.ds, algoKind);

      await this.ds.transaction(async (manager) => {
        const session = await this.simSessionService.ensureActiveSession(
          algoKind,
          manager,
        );
        const allPositions = await manager.find(CopiedPosition, {
          where: { mode: 'sim' },
        });
        const scopedPositions = allPositions.filter(
          (p) => algoKindFromReason(p.reason) === algoKind,
        );
        const positionIds = scopedPositions.map((p) => p.id);
        const conditionIds = [
          ...new Set(scopedPositions.map((p) => p.conditionId)),
        ];

        await this.resetArchiveService.archiveSession(manager, session);
        await this.resetArchiveService.purgeAlgoScopedMarketData(
          manager,
          algoKind,
          positionIds,
          conditionIds,
        );
        await this.simService.resetWithManager(algoKind, manager, amount);
        const balance = await manager
          .getRepository(SimulationBalance)
          .findOne({ where: { algoKind } });
        const sessionStartedAt = balance?.sessionStartedAt ?? new Date();
        await this.simSessionService.rotateAfterReset(algoKind, manager, {
          endingEquity,
          endingSessionPnl,
          newBaselineCapital: amount,
          sessionStartedAt,
          newSessionLabel: null,
        });
      });
      RiskService.invalidateConfigCache();

      await purgeSimExecutionRedisState(getRedis(), redisPurgeHints, algoKind);

      const balanceRow = await this.ds
        .getRepository(SimulationBalance)
        .findOne({ where: { algoKind } });

      emitSimulationReset({ algoKind });
      await publishSimulationReset(getRedis(), {
        algoKind,
        sessionStartedAt: balanceRow?.sessionStartedAt?.toISOString(),
      });

      lastClosedId = activeSession.id;
      lastOpenedId = (await this.simSessionService.getActiveSession(algoKind))!.id;
    }

    await broadcastSimSnapshot(this.ds);

    if (lastOpenedId == null) return null;
    return { closedId: lastClosedId, openedId: lastOpenedId };
  }

  private async performRealSoftRotate(): Promise<RealRotationResult | null> {
    const activeSession = await this.realSessionService.getActiveSession();
    if (!activeSession) {
      const opened = await this.ds.transaction(async (manager) => {
        const session = await this.realSessionService.ensureActiveSession(manager);
        await this.realSessionService.stampSessionConfig(manager, session.id);
        return session;
      });
      return { closedId: null, openedId: opened.id };
    }

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
        /* fallback */
      }
    }

    if (observedCash != null) {
      try {
        const snap = await this.realArchiveService.createSnapshot({
          source: 'config_change' as never,
          label: 'Avant changement de config',
          observedCash,
          skipIfEmpty: true,
        });
        if (snap) {
          recordSnapshotCreated('config_change', 'real');
        }
      } catch {
        /* best-effort */
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
          /* archive best-effort */
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
    } catch {
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
