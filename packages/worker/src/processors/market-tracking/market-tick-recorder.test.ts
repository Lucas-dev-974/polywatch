import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketTickRecorder } from './market-tick-recorder.js';
import { OpenPositionTracker } from './open-position-tracker.js';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import { MarketMetricsCache } from '../../polymarket/market-metrics-cache.js';
import { MarketPositionTickService } from '@polywatch/core';
import { initializeDataSource, createTestDataSource } from '@polywatch/core';
import { seedDefaults } from '@polywatch/core';
import { CopiedPosition } from '@polywatch/core';

function makeConnectionManager() {
  const metricsCache = new MarketMetricsCache();
  const manager = {
    getMetricsCache: vi.fn().mockReturnValue(metricsCache),
    getExecutableSpread: vi.fn().mockReturnValue(0.02),
    getExecutablePrices: vi.fn().mockReturnValue({
      executableBidVwap: 0.48,
      executableAskVwap: 0.52,
      liquidityStatus: 'ok',
    }),
    getOrderBook: vi.fn().mockReturnValue(undefined),
  } as unknown as PolymarketConnectionManager;
  return { manager, metricsCache };
}

describe('MarketTickRecorder', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let tracker: OpenPositionTracker;
  let tickService: MarketPositionTickService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    tracker = new OpenPositionTracker(ds);
    tickService = new MarketPositionTickService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedOpenPosition(overrides: Partial<CopiedPosition> = {}) {
    const repo = ds.getRepository(CopiedPosition);
    return repo.save(
      repo.create({
        watchlistId: 1,
        conditionId: 'cond-1',
        assetId: 'asset-1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        reason: 'COPY_OPEN',
        realizedPnl: 0,
        unrealizedPnl: 0,
        ...overrides,
      }),
    );
  }

  it('records one tick per tracked position on a book update', async () => {
    const posA = await seedOpenPosition({ id: undefined, outcome: 'Yes' });
    const posB = await seedOpenPosition({ id: undefined, outcome: 'No' });
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('asset-1', 0.48, 0.52, 0.04);
    metricsCache.setConditionId('asset-1', 'cond-1');
    metricsCache.updateLastTrade('asset-1', 0.5, 1, new Date().toISOString());

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.handleBookUpdate('asset-1');

    await new Promise((r) => setTimeout(r, 50));

    const rowsA = await tickService.listByPosition(posA.id);
    const rowsB = await tickService.listByPosition(posB.id);
    expect(rowsA.total).toBe(1);
    expect(rowsB.total).toBe(1);

    const row = rowsA.items[0];
    expect(row.bestBid).toBe(0.48);
    expect(row.bestAsk).toBe(0.52);
    expect(row.midPrice).toBe(0.5);
    expect(row.spread).toBeCloseTo(0.04, 10);
    expect(row.spreadPercent).toBeCloseTo(0.08, 10);
    expect(row.executableBidVwap).toBe(0.48);
    expect(row.executableAskVwap).toBe(0.52);
    expect(row.lastTradePrice).toBe(0.5);
    expect(row.conditionId).toBe('cond-1');
  });

  it('skips crypto-algo positions (ALGO_*) — covered by algo_price_ticks', async () => {
    const algoPos = await seedOpenPosition({ reason: 'ALGO_OPEN' });
    const copyPos = await seedOpenPosition({
      reason: 'COPY_OPEN',
      outcome: 'No',
    });
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('asset-1', 0.48, 0.52, 0.04);
    metricsCache.setConditionId('asset-1', 'cond-1');

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.handleBookUpdate('asset-1');

    await new Promise((r) => setTimeout(r, 50));

    expect((await tickService.listByPosition(algoPos.id)).total).toBe(0);
    expect((await tickService.listByPosition(copyPos.id)).total).toBe(1);
  });

  it('does not record open tick for crypto-algo positions', async () => {
    const algoPos = await seedOpenPosition({ reason: 'ALGO_OPEN' });
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('asset-1', 0.48, 0.52, 0.04);

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.recordPositionOpen(algoPos);

    await new Promise((r) => setTimeout(r, 50));

    expect((await tickService.listByPosition(algoPos.id)).total).toBe(0);
  });

  it('still records ticks for weather positions', async () => {
    const weatherPos = await seedOpenPosition({ reason: 'WEATHER_OPEN' });
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('asset-1', 0.48, 0.52, 0.04);
    metricsCache.setConditionId('asset-1', 'cond-1');

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.handleBookUpdate('asset-1');

    await new Promise((r) => setTimeout(r, 50));

    expect((await tickService.listByPosition(weatherPos.id)).total).toBe(1);
  });

  it('does nothing when no tracked position for the asset', async () => {
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('unknown-asset', 0.5, 0.5, 0);

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.handleBookUpdate('unknown-asset');

    await new Promise((r) => setTimeout(r, 50));

    const result = await tickService.listByMarket('cond-missing');
    expect(result.total).toBe(0);
  });

  it('throttles subsequent updates within the throttle window', async () => {
    const pos = await seedOpenPosition();
    await tracker.refresh();

    const { manager, metricsCache } = makeConnectionManager();
    metricsCache.updateTopOfBook('asset-1', 0.48, 0.52, 0.04);

    const recorder = new MarketTickRecorder(manager, tracker, tickService);
    recorder.handleBookUpdate('asset-1');
    recorder.handleBookUpdate('asset-1');
    recorder.handleBookUpdate('asset-1');

    await new Promise((r) => setTimeout(r, 50));

    const result = await tickService.listByPosition(pos.id);
    expect(result.total).toBe(1);
  });
});
