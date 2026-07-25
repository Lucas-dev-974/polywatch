import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { RealSession } from '../entities/RealSession.js';
import { RealStateSnapshot } from '../entities/RealStateSnapshot.js';
import { seedDefaults } from '../seed/defaults.js';
import { RealArchiveService } from './real-archive.service.js';
import { RealPeriodArchiveService } from './real-period-archive.service.js';

type DataSourceType = Awaited<ReturnType<typeof initializeDataSource>>;

const OBSERVED_CASH = 500;

async function seedRealPositions(ds: DataSourceType): Promise<{
  openPos: CopiedPosition;
  closedPos: CopiedPosition;
}> {
  const posRepo = ds.getRepository(CopiedPosition);
  const openPos = await posRepo.save(
    posRepo.create({
      watchlistId: 1,
      conditionId: 'real-open-c1',
      assetId: 'real-open-a1',
      outcome: 'Yes',
      side: 'BUY',
      quantity: 10,
      entryPrice: 0.5,
      entryBidVwap: 0.5,
      entryQuantityRemaining: 10,
      entryFees: 0,
      entryFeesRemaining: 0,
      status: 'open',
      mode: 'real',
      realizedPnl: 0,
      openedAt: new Date('2026-07-01T10:00:00Z'),
    }),
  );
  const closedPos = await posRepo.save(
    posRepo.create({
      watchlistId: 1,
      conditionId: 'real-closed-c1',
      assetId: 'real-closed-a1',
      outcome: 'Yes',
      side: 'BUY',
      quantity: 5,
      entryPrice: 0.6,
      entryBidVwap: 0.6,
      entryQuantityRemaining: 0,
      entryFees: 0,
      entryFeesRemaining: 0,
      status: 'closed',
      mode: 'real',
      realizedPnl: 3,
      openedAt: new Date('2026-07-01T08:00:00Z'),
      closedAt: new Date('2026-07-01T12:00:00Z'),
    }),
  );
  return { openPos, closedPos };
}

describe('RealArchiveService', () => {
  let ds: DataSourceType;
  let archiveService: RealArchiveService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    archiveService = new RealArchiveService(ds);
    await seedRealPositions(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('createSnapshot', () => {
    it('creates a manual snapshot with correct source and counts', async () => {
      const summary = await archiveService.createSnapshot({
        source: 'manual',
        label: 'Test réel',
        observedCash: OBSERVED_CASH,
      });

      expect(summary).not.toBeNull();
      expect(summary!.source).toBe('manual');
      expect(summary!.label).toBe('Test réel');
      expect(summary!.positionCount).toBe(2);
      expect(summary!.openPositionCount).toBe(1);
      expect(summary!.closedPositionCount).toBe(1);
      expect(summary!.sessionId).not.toBeNull();
    });

    it('skips empty snapshot when skipIfEmpty is true', async () => {
      await ds.getRepository(CopiedPosition).clear();

      const summary = await archiveService.createSnapshot({
        source: 'manual',
        observedCash: OBSERVED_CASH,
        skipIfEmpty: true,
      });

      expect(summary).toBeNull();
    });

    it('getSnapshotDetail returns parsed JSON structure', async () => {
      const summary = await archiveService.createSnapshot({
        source: 'manual',
        observedCash: OBSERVED_CASH,
      });
      expect(summary).not.toBeNull();

      const detail = await archiveService.getSnapshotDetail(summary!.id);
      expect(detail).not.toBeNull();
      expect(typeof detail!.config).toBe('object');
      expect(detail!.config.realCashOverride).toBeDefined();
      expect(Array.isArray(detail!.traders)).toBe(true);
      expect(Array.isArray(detail!.positions)).toBe(true);
    });
  });

  describe('createAutoSnapshotIfDue', () => {
    it('creates the first auto snapshot when due', async () => {
      const summary = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 3600,
        observedCash: OBSERVED_CASH,
      });

      expect(summary).not.toBeNull();
      expect(summary?.source).toBe('auto');
      expect(
        await ds.getRepository(RealStateSnapshot).count({
          where: { source: 'auto' },
        }),
      ).toBe(1);
    });
  });

  describe('period archive invariants', () => {
    let periodArchiveService: RealPeriodArchiveService;
    let session: RealSession;
    let openPos: CopiedPosition;
    let closedPos: CopiedPosition;

    beforeEach(async () => {
      periodArchiveService = new RealPeriodArchiveService(ds);
      const sessionRepo = ds.getRepository(RealSession);
      session = await sessionRepo.save(
        sessionRepo.create({
          startedAt: new Date('2026-07-01T00:00:00Z'),
          status: 'active',
          baselineCapital: 1000,
          snapshotCount: 0,
          configJson: '{}',
        }),
      );

      await ds.getRepository(CopiedPosition).clear();
      const seeded = await seedRealPositions(ds);
      openPos = seeded.openPos;
      closedPos = seeded.closedPos;

      await ds.getRepository(Execution).save(
        ds.getRepository(Execution).create({
          orderSignalId: 'sig-real-1',
          copiedPositionId: closedPos.id,
          mode: 'real',
          side: 'BUY',
          status: 'filled',
          fees: 0,
          realizedPnl: 0,
        }),
      );

      await ds.getRepository(ExitAttemptEvent).save(
        ds.getRepository(ExitAttemptEvent).create({
          copiedPositionId: closedPos.id,
          mode: 'real',
          kind: 'emit_blocked',
          closeReason: 'SL',
          blockReason: 'liquidity',
          createdAt: new Date('2026-07-01T11:00:00Z'),
        }),
      );
    });

    it('preserves open positions after archive and clear', async () => {
      const rotateAt = new Date('2026-07-02T00:00:00Z');

      const { archivedPositionIds } = await ds.transaction(async (manager) => {
        const result = await periodArchiveService.archiveClosedInWindow(
          manager,
          session,
          rotateAt,
        );
        await periodArchiveService.clearArchivedLive(
          manager,
          result.archivedPositionIds,
        );
        return result;
      });

      expect(archivedPositionIds.length).toBe(1);

      const remaining = await ds.getRepository(CopiedPosition).find({
        where: { mode: 'real' },
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(openPos.id);
      expect(remaining[0].status).toBe('open');
    });

    it('clears only archived closed position IDs and related rows', async () => {
      const rotateAt = new Date('2026-07-02T00:00:00Z');

      const { archivedPositionIds } = await ds.transaction(async (manager) => {
        const result = await periodArchiveService.archiveClosedInWindow(
          manager,
          session,
          rotateAt,
        );
        await periodArchiveService.clearArchivedLive(
          manager,
          result.archivedPositionIds,
        );
        return result;
      });

      expect(archivedPositionIds).toContain(closedPos.id);
      expect(archivedPositionIds).not.toContain(openPos.id);

      const closedStillExists = await ds.getRepository(CopiedPosition).findOne({
        where: { id: closedPos.id },
      });
      expect(closedStillExists).toBeNull();

      const openStillExists = await ds.getRepository(CopiedPosition).findOne({
        where: { id: openPos.id },
      });
      expect(openStillExists).not.toBeNull();

      const closedExecutions = await ds.getRepository(Execution).count({
        where: { mode: 'real', copiedPositionId: closedPos.id },
      });
      expect(closedExecutions).toBe(0);

      const closedExitAttempts = await ds.getRepository(ExitAttemptEvent).count({
        where: { mode: 'real', copiedPositionId: closedPos.id },
      });
      expect(closedExitAttempts).toBe(0);
    });
  });
});
