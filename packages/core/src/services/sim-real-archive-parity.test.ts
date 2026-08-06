import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { seedDefaults } from '../seed/defaults.js';
import { SimulationArchiveService } from './simulation-archive.service.js';
import { RealArchiveService } from './real-archive.service.js';

describe('sim vs real archive snapshot parity', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedOpenPosition(mode: 'sim' | 'real'): Promise<void> {
    await ds.getRepository(CopiedPosition).save(
      ds.getRepository(CopiedPosition).create({
        watchlistId: 1,
        conditionId: mode === 'sim' ? 'sim-c1' : 'real-c1',
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
        mode,
        reason: 'ALGO_OPEN',
        realizedPnl: 0,
      }),
    );
  }

  it('manual snapshots share position counts for equivalent open positions', async () => {
    await seedOpenPosition('sim');
    await seedOpenPosition('real');

    const simArchive = new SimulationArchiveService(ds);
    const realArchive = new RealArchiveService(ds);

    const simSummary = await simArchive.createSnapshot({
      algoKind: 'crypto',
      source: 'manual',
      label: 'parity-test',
    });
    const realSummary = await realArchive.createSnapshot({
      source: 'manual',
      label: 'parity-test',
      observedCash: 500,
    });

    expect(simSummary).not.toBeNull();
    expect(realSummary).not.toBeNull();
    expect(simSummary!.source).toBe('manual');
    expect(realSummary!.source).toBe('manual');
    expect(simSummary!.positionCount).toBe(1);
    expect(realSummary!.positionCount).toBe(1);
    expect(simSummary!.label).toBe('parity-test');
    expect(realSummary!.label).toBe('parity-test');
  });
});
