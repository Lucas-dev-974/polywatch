import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { AlgoPriceTick } from '../entities/AlgoPriceTick.js';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { MarketPositionTick } from '../entities/MarketPositionTick.js';
import { MarketPriceHistorySync } from '../entities/MarketPriceHistorySync.js';
import { MarketPriceTick } from '../entities/MarketPriceTick.js';
import { CryptoConfig } from '../entities/CryptoConfig.js';
import { SimulationSession } from '../entities/SimulationSession.js';
import { seedDefaults } from '../seed/defaults.js';
import { SimulationResetArchiveService } from './simulation-reset-archive.service.js';
import { SimulationService } from './simulation.service.js';

type DataSourceType = Awaited<ReturnType<typeof initializeDataSource>>;

describe('SimulationResetArchiveService', () => {
  let ds: DataSourceType;
  let archiveService: SimulationResetArchiveService;
  let session: SimulationSession;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    archiveService = new SimulationResetArchiveService(ds);

    const sessionRepo = ds.getRepository(SimulationSession);
    session = await sessionRepo.save(
      sessionRepo.create({
        algoKind: 'crypto',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'active',
        baselineCapital: 1000,
        snapshotCount: 0,
        configJson: '{}',
      }),
    );

    const posRepo = ds.getRepository(CopiedPosition);
    const simPos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'sim-c1',
        assetId: 'sim-a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closed',
        mode: 'sim',
        reason: 'ALGO_OPEN',
        realizedPnl: 5,
        openedAt: new Date('2026-01-01T01:00:00Z'),
        closedAt: new Date('2026-01-01T02:00:00Z'),
      }),
    );
    await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'real-c1',
        assetId: 'real-a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 5,
        entryPrice: 0.6,
        entryBidVwap: 0.6,
        entryQuantityRemaining: 5,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'real',
        realizedPnl: 0,
      }),
    );

    const execRepo = ds.getRepository(Execution);
    await execRepo.save(
      execRepo.create({
        orderSignalId: 'sig-sim-1',
        copiedPositionId: simPos.id,
        mode: 'sim',
        side: 'BUY',
        status: 'filled',
        fees: 0,
        realizedPnl: 0,
      }),
    );

    await ds.getRepository(ExitAttemptEvent).save(
      ds.getRepository(ExitAttemptEvent).create({
        copiedPositionId: simPos.id,
        mode: 'sim',
        kind: 'emit_blocked',
        closeReason: 'SL',
        blockReason: 'liquidity',
        createdAt: new Date('2026-01-01T01:30:00Z'),
      }),
    );

    await ds.getRepository(AlgoSurveillanceSnapshot).save(
      ds.getRepository(AlgoSurveillanceSnapshot).create({
        conditionId: 'sim-c1',
        closeCapturedAt: new Date('2026-01-01T03:00:00Z'),
        positionsJson: '[]',
      }),
    );
    await ds.getRepository(AlgoSurveillanceSnapshot).save(
      ds.getRepository(AlgoSurveillanceSnapshot).create({
        conditionId: 'other-live',
        openCapturedAt: new Date('2026-01-01T03:00:00Z'),
      }),
    );

    await ds.getRepository(MarketPositionTick).save(
      ds.getRepository(MarketPositionTick).create({
        copiedPositionId: simPos.id,
        conditionId: 'sim-c1',
        assetId: 'sim-a1',
        outcome: 'Yes',
        bestBid: 0.48,
        bestAsk: 0.52,
        midPrice: 0.5,
        spread: 0.04,
        spreadPercent: 0.08,
        createdAt: new Date('2026-01-01T01:15:00Z'),
      }),
    );

    await ds.getRepository(AlgoPriceTick).save(
      ds.getRepository(AlgoPriceTick).create({
        conditionId: 'sim-c1',
        upPrice: 0.55,
        downPrice: 0.45,
        recordedAt: new Date('2026-01-01T01:00:00Z'),
      }),
    );
    await ds.getRepository(AlgoPriceTick).save(
      ds.getRepository(AlgoPriceTick).create({
        conditionId: 'sim-c1',
        upPrice: 0.56,
        downPrice: 0.44,
        recordedAt: new Date('2026-01-01T01:00:30Z'),
      }),
    );

    await ds.getRepository(MarketPriceTick).save(
      ds.getRepository(MarketPriceTick).create({
        conditionId: 'sim-c1',
        assetId: 'sim-a1',
        midPrice: 0.5,
        recordedAt: new Date('2026-01-01T01:00:00Z'),
      }),
    );

    await ds.getRepository(MarketPriceHistorySync).save(
      ds.getRepository(MarketPriceHistorySync).create({
        conditionId: 'mkt-c1',
        assetId: 'mkt-a1',
        syncStatus: 'done',
        lastPointTs: 12345,
      }),
    );
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('archives sim session data and writes summary', async () => {
    let summary!: Awaited<ReturnType<SimulationResetArchiveService['archiveSession']>>;
    await ds.transaction(async (manager) => {
      summary = await archiveService.archiveSession(manager, session);
    });

    expect(summary.positions).toBe(1);
    expect(summary.executions).toBe(1);
    expect(summary.exitAttempts).toBe(1);
    expect(summary.surveillance).toBe(1);
    expect(summary.candles).toBeGreaterThan(0);

    const refreshed = await ds
      .getRepository(SimulationSession)
      .findOne({ where: { id: session.id } });
    expect(refreshed?.archiveSummaryJson).toBeTruthy();

    const archive = await archiveService.getArchive(session.id, 'positions', {
      limit: 10,
    });
    expect(archive?.total).toBe(1);
    expect(archive?.items[0]).toMatchObject({ conditionId: 'sim-c1' });
  });

  it('purgeAlgoScopedMarketData removes only scoped sim market artifacts', async () => {
    const simPos = await ds.getRepository(CopiedPosition).findOne({
      where: { mode: 'sim' },
    });
    expect(simPos).toBeTruthy();

    await ds.transaction(async (manager) => {
      await archiveService.purgeAlgoScopedMarketData(
        manager,
        'crypto',
        [simPos!.id],
        ['sim-c1'],
      );
    });

    expect(await ds.getRepository(MarketPositionTick).count()).toBe(0);
    expect(await ds.getRepository(AlgoPriceTick).count()).toBe(2);
    expect(await ds.getRepository(MarketPriceTick).count()).toBe(1);
    expect(await ds.getRepository(ExitAttemptEvent).count()).toBe(0);

    const surv = await ds.getRepository(AlgoSurveillanceSnapshot).find();
    expect(surv).toHaveLength(1);
    expect(surv[0]?.conditionId).toBe('other-live');

    const sync = await ds.getRepository(MarketPriceHistorySync).findOne({
      where: { conditionId: 'mkt-c1' },
    });
    expect(sync?.lastPointTs).toBe(12345);
    expect(sync?.syncStatus).toBe('done');
  });

  it('archives surveillance scoped to session position conditionIds', async () => {
    const survRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    const bulkRows = Array.from({ length: 200 }, (_, index) =>
      survRepo.create({
        conditionId: `surv-bulk-${index}`,
        positionsJson: '[]',
      }),
    );
    for (let i = 0; i < bulkRows.length; i += 50) {
      await survRepo.save(bulkRows.slice(i, i + 50));
    }

    let summary!: Awaited<ReturnType<SimulationResetArchiveService['archiveSession']>>;
    await ds.transaction(async (manager) => {
      summary = await archiveService.archiveSession(manager, session);
    });

    expect(summary.surveillance).toBe(1);
    const archive = await archiveService.getArchive(session.id, 'surveillance', {
      limit: 200,
    });
    expect(archive?.total).toBe(1);
  });

  it('resetWithManager clears sim positions only', async () => {
    const simulationService = new SimulationService(ds);
    await ds.transaction(async (manager) => {
      await simulationService.resetWithManager('crypto', manager, 1000);
    });

    const simCount = await ds.getRepository(CopiedPosition).count({
      where: { mode: 'sim' },
    });
    const realCount = await ds.getRepository(CopiedPosition).count({
      where: { mode: 'real' },
    });
    expect(simCount).toBe(0);
    expect(realCount).toBe(1);
  });

  it('resetWithManager persists amount as simInitialCapital', async () => {
    const simulationService = new SimulationService(ds);
    await ds.transaction(async (manager) => {
      await simulationService.resetWithManager('crypto', manager, 4200);
    });

    const crypto = await ds.getRepository(CryptoConfig).findOne({ where: {} });
    expect(crypto?.simInitialCapitalCrypto).toBe(4200);
  });
});
