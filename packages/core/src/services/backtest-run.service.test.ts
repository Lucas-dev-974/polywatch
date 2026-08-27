import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { BacktestRunService } from './backtest-run.service.js';

describe('BacktestRunService — singleton lock', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: BacktestRunService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    service = new BacktestRunService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('detects a queued run as active (prevents concurrent launch)', async () => {
    const run = await service.create({
      domain: 'weather',
      mode: 'reevaluate',
      paramsJson: JSON.stringify({}),
    });
    // Default status from create() is 'queued' — hasActiveRun must catch it.
    const active = await service.hasActiveRun('weather');
    expect(active?.id).toBe(run.id);
  });

  it('detects a running run as active', async () => {
    const run = await service.create({
      domain: 'weather',
      mode: 'reevaluate',
      paramsJson: JSON.stringify({}),
    });
    await service.markStarted(run.id);
    const active = await service.hasActiveRun('weather');
    expect(active?.id).toBe(run.id);
  });

  it('does not treat a completed run as active', async () => {
    const run = await service.create({
      domain: 'weather',
      mode: 'reevaluate',
      paramsJson: JSON.stringify({}),
    });
    await service.markCompleted(run.id, {
      totalPnl: 0, pnlPct: 0, finalEquity: 1000, maxDrawdown: 0, winRate: 0,
      profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, totalTrades: 0,
      avgHoldingMs: 0, byExitReason: {}, byCity: {},
    }, [], null, null);
    expect(await service.hasActiveRun('weather')).toBeNull();
  });
});

describe('BacktestRunService — multi-user isolation (IDOR)', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: BacktestRunService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    service = new BacktestRunService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function createRun(userId: number | null) {
    return service.create({
      domain: 'weather',
      mode: 'reevaluate',
      paramsJson: JSON.stringify({}),
      userId,
    });
  }

  it('filters list by owner user', async () => {
    await createRun(1);
    await createRun(2);
    const user1 = await service.list({ domain: 'weather', userId: 1 });
    expect(user1.items).toHaveLength(1);
    expect(user1.items[0]!.userId).toBe(1);
  });

  it('getById returns null when the run belongs to another user', async () => {
    const runA = await createRun(1);
    expect(await service.getById(runA.id, 1)).not.toBeNull();
    // User 2 cannot see user 1's run (IDOR guard).
    expect(await service.getById(runA.id, 2)).toBeNull();
  });

  it('legacy runs (userId null) remain visible to every user', async () => {
    const legacy = await createRun(null);
    expect(await service.getById(legacy.id, 1)).not.toBeNull();
    expect(await service.getById(legacy.id, 2)).not.toBeNull();
    const list = await service.list({ domain: 'weather', userId: 3 });
    expect(list.items.map((r) => r.id)).toContain(legacy.id);
  });

  it('singleton lock is per-user: two users can each hold an active run', async () => {
    await createRun(1);
    await createRun(2);
    expect((await service.hasActiveRun('weather', 1))?.userId).toBe(1);
    expect((await service.hasActiveRun('weather', 2))?.userId).toBe(2);
    // No active run without a matching owner.
    expect(await service.hasActiveRun('weather', 99)).toBeNull();
  });

  it('delete cascades to positions/equity/excluded ticks', async () => {
    const run = await createRun(1);
    await service.appendPositions(run.id, [
      {
        conditionId: 'c1', side: 'YES', qty: 1, entryPrice: 0.5, entryAt: new Date(),
        exitPrice: 0.6, exitAt: new Date(), exitReason: 'TP', pnl: 0.1, fees: 0,
      },
    ]);
    await service.appendEquity(run.id, [
      { t: new Date(), equity: 1000, cash: 1000, openPositions: 1 },
    ]);
    await service.delete(run.id);
    expect(await service.getById(run.id, 1)).toBeNull();
    expect((await service.listPositions(run.id, {})).items).toHaveLength(0);
    expect(await service.listEquity(run.id)).toHaveLength(0);
  });
});
