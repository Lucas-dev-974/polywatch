import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';
import { seedDefaults } from '../seed/defaults.js';
import { SimulationArchiveService } from './simulation-archive.service.js';

type DataSourceType = Awaited<ReturnType<typeof initializeDataSource>>;

async function seedSimPosition(ds: DataSourceType): Promise<void> {
  const posRepo = ds.getRepository(CopiedPosition);
  await posRepo.save(
    posRepo.create({
      watchlistId: 1,
      conditionId: 'c1',
      assetId: 'a1',
      outcome: 'Yes',
      side: 'BUY',
      quantity: 10,
      entryPrice: 0.5,
      entryBidVwap: 0.5,
      entryQuantityRemaining: 10,
      entryFees: 0,
      entryFeesRemaining: 0,
      status: 'open',
      mode: 'sim',
      realizedPnl: 0,
    }),
  );
}

describe('SimulationArchiveService', () => {
  let ds: DataSourceType;
  let archiveService: SimulationArchiveService;

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    await seedDefaults(ds);
    archiveService = new SimulationArchiveService(ds);
    await seedSimPosition(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('createAutoSnapshotIfDue', () => {
    it('creates the first auto snapshot when due', async () => {
      const summary = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 3600,
      });

      expect(summary).not.toBeNull();
      expect(summary?.source).toBe('auto');
      expect(
        await ds.getRepository(SimulationStateSnapshot).count({
          where: { source: 'auto' },
        }),
      ).toBe(1);
    });

    it('skips a second creation within the interval (DB-clock based)', async () => {
      const first = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 3600,
      });
      expect(first).not.toBeNull();

      const tooSoon = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 3600,
      });

      expect(tooSoon).toBeNull();
      expect(
        await ds.getRepository(SimulationStateSnapshot).count({
          where: { source: 'auto' },
        }),
      ).toBe(1);
    });

    it('creates again once the elapsed age exceeds the interval', async () => {
      const first = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 3600,
      });
      expect(first).not.toBeNull();

      // With a zero interval, any elapsed age (>= 0) is due.
      const second = await archiveService.createAutoSnapshotIfDue({
        intervalSec: 0,
        minIntervalSec: 0,
      });
      expect(second).not.toBeNull();
      expect(
        await ds.getRepository(SimulationStateSnapshot).count({
          where: { source: 'auto' },
        }),
      ).toBe(2);
    });
  });

  describe('CRUD', () => {
    it('createSnapshot with source=manual returns summary with correct source', async () => {
      const summary = await archiveService.createSnapshot({
        source: 'manual',
        label: 'Test manuel',
      });

      expect(summary).not.toBeNull();
      expect(summary!.source).toBe('manual');
      expect(summary!.label).toBe('Test manuel');
      expect(summary!.positionCount).toBe(1);
    });

    it('createSnapshot with source=reset creates a reset snapshot', async () => {
      const summary = await archiveService.createSnapshot({
        source: 'reset',
        label: 'Avant réinitialisation',
        skipIfEmpty: true,
      });

      expect(summary).not.toBeNull();
      expect(summary!.source).toBe('reset');
      expect(summary!.label).toBe('Avant réinitialisation');
    });

    it('persistSnapshot with skipIfEmpty and no data returns null', async () => {
      // Clear the seeded position
      await ds.getRepository(CopiedPosition).clear();

      const summary = await archiveService.createSnapshot({
        source: 'manual',
        skipIfEmpty: true,
      });

      expect(summary).toBeNull();
    });

    it('listSnapshots filters by source', async () => {
      await archiveService.createSnapshot({ source: 'manual' });
      await archiveService.createSnapshot({ source: 'reset', label: 'reset' });

      const manual = await archiveService.listSnapshots({ source: 'manual' });
      expect(manual.total).toBe(1);
      expect(manual.items[0].source).toBe('manual');

      const reset = await archiveService.listSnapshots({ source: 'reset' });
      expect(reset.total).toBe(1);
      expect(reset.items[0].source).toBe('reset');
    });

    it('listSnapshots filters by label (case-insensitive)', async () => {
      await archiveService.createSnapshot({ source: 'manual', label: 'MonSnapshotTest' });

      const result = await archiveService.listSnapshots({ label: 'snapshot' });
      expect(result.total).toBe(1);
    });

    it('listSnapshots filters by date range', async () => {
      await archiveService.createSnapshot({ source: 'manual' });

      const today = new Date().toISOString().slice(0, 10);
      const result = await archiveService.listSnapshots({
        from: today,
        to: today,
      });
      expect(result.total).toBe(1);
    });

    it('getSnapshotDetail returns parsed JSON with correct structure', async () => {
      const summary = await archiveService.createSnapshot({ source: 'manual' });
      expect(summary).not.toBeNull();

      const detail = await archiveService.getSnapshotDetail(summary!.id);
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(summary!.id);
      expect(typeof detail!.config).toBe('object');
      expect(Array.isArray(detail!.traders)).toBe(true);
      expect(Array.isArray(detail!.positions)).toBe(true);
      expect(Array.isArray(detail!.executions)).toBe(true);
      expect(Array.isArray(detail!.exitAttempts)).toBe(true);
      expect(Array.isArray(detail!.moveEvents)).toBe(true);
      expect(detail!.decisionSummary).not.toBeNull();
      expect(detail!.sessionId).not.toBeNull();
    });

    it('getSnapshotDetail returns null for non-existent id', async () => {
      const detail = await archiveService.getSnapshotDetail(9999);
      expect(detail).toBeNull();
    });

    it('deleteAllSnapshots removes all rows and returns count', async () => {
      await archiveService.createSnapshot({ source: 'manual' });
      await archiveService.createSnapshot({ source: 'manual' });

      const deleted = await archiveService.deleteAllSnapshots();
      expect(deleted).toBe(2);

      const remaining = await ds.getRepository(SimulationStateSnapshot).count();
      expect(remaining).toBe(0);
    });

    it('deleteAllSnapshots on empty table returns 0', async () => {
      const deleted = await archiveService.deleteAllSnapshots();
      expect(deleted).toBe(0);
    });
  });
});