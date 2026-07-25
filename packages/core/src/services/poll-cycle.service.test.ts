import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { PollCycleService } from './poll-cycle.service.js';

async function seedOpenCopiedPosition(
  ds: Awaited<ReturnType<typeof initializeDataSource>>,
  traderAddress: string,
  conditionId: string,
  assetId: string,
): Promise<void> {
  const watchlistRepo = ds.getRepository(WatchlistEntry);
  const positionRepo = ds.getRepository(CopiedPosition);
  const entry = await watchlistRepo.save(
    watchlistRepo.create({ traderAddress, active: true }),
  );
  await positionRepo.save(
    positionRepo.create({
      watchlistId: entry.id,
      conditionId,
      assetId,
      outcome: 'Yes',
      quantity: 10,
      entryPrice: 0.5,
      entryBidVwap: 0.5,
      mode: 'sim',
      status: 'open',
    }),
  );
}

describe('PollCycleService', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: PollCycleService;
  const trader = '0xtrader1';

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    service = new PollCycleService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('baseline poll does not emit move events', async () => {
    const moves = await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 100, avgPrice: 0.6 },
    ]);
    expect(moves).toHaveLength(0);
  });

  it('detects OPENED on second poll', async () => {
    await service.runPollCycle(trader, [
      { conditionId: 'c0', assetId: 'a0', size: 0 },
    ]);
    const moves = await service.runPollCycle(trader, [
      { conditionId: 'c0', assetId: 'a0', size: 0 },
      { conditionId: 'c1', assetId: 'a1', size: 200, avgPrice: 0.6 },
    ]);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('OPENED');
    expect(moves[0].traderSize).toBe(200);
  });

  it('reconcile ignores OPENED', async () => {
    await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 100 },
    ]);
    const moves = await service.reconcile(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 200 },
      { conditionId: 'c2', assetId: 'a2', size: 50 },
    ]);
    expect(moves.every((m) => m.type !== 'OPENED')).toBe(true);
  });

  it('skips CLOSED when position disappears without copied position', async () => {
    await service.runPollCycle(trader, []);
    await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 100 },
    ]);
    const moves = await service.runPollCycle(trader, []);
    expect(moves.some((m) => m.type === 'CLOSED')).toBe(false);
  });

  it('detects CLOSED when position disappears and copied position is open', async () => {
    await service.runPollCycle(trader, []);
    await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 100 },
    ]);
    await seedOpenCopiedPosition(ds, trader, 'c1', 'a1');
    const moves = await service.runPollCycle(trader, []);
    expect(moves.some((m) => m.type === 'CLOSED')).toBe(true);
  });

  it('propagates outcome on OPENED and CLOSED', async () => {
    await service.runPollCycle(trader, [{ conditionId: 'c0', assetId: 'a0', size: 0 }]);

    const opened = await service.runPollCycle(trader, [
      { conditionId: 'c0', assetId: 'a0', size: 0 },
      {
        conditionId: 'cBTC',
        assetId: 'tokenDown',
        size: 150,
        outcome: 'Down',
      },
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0].outcome).toBe('Down');

    await seedOpenCopiedPosition(ds, trader, 'cBTC', 'tokenDown');
    const closed = await service.runPollCycle(trader, [
      { conditionId: 'c0', assetId: 'a0', size: 0 },
    ]);
    const closeMove = closed.find((m) => m.type === 'CLOSED');
    expect(closeMove?.outcome).toBe('Down');
  });

  it('ignores float4 noise below size tolerance', async () => {
    const baseSize = 34207.914;
    await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: baseSize },
    ]);
    await seedOpenCopiedPosition(ds, trader, 'c1', 'a1');

    const moves = await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: baseSize + 0.0001 },
    ]);
    expect(moves).toHaveLength(0);
  });

  it('detects real DECREASED above size tolerance', async () => {
    await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 100 },
    ]);
    await seedOpenCopiedPosition(ds, trader, 'c1', 'a1');

    const moves = await service.runPollCycle(trader, [
      { conditionId: 'c1', assetId: 'a1', size: 90 },
    ]);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('DECREASED');
    expect(moves[0].traderSize).toBe(90);
  });
});
