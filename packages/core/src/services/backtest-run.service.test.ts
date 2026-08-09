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
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });
    // Default status from create() is 'queued' — hasActiveRun must catch it.
    const active = await service.hasActiveRun('weather');
    expect(active?.id).toBe(run.id);
  });

  it('detects a running run as active', async () => {
    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });
    await service.markStarted(run.id);
    const active = await service.hasActiveRun('weather');
    expect(active?.id).toBe(run.id);
  });

  it('does not treat a completed run as active', async () => {
    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
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
