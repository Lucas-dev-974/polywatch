import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { MarketPositionTick } from '../entities/MarketPositionTick.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { MarketPositionTickService } from './market-position-tick.service.js';
import { seedDefaults } from '../seed/defaults.js';

describe('MarketPositionTickService', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: MarketPositionTickService;

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    await seedDefaults(ds);
    service = new MarketPositionTickService(ds);
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
        realizedPnl: 0,
        unrealizedPnl: 0,
        ...overrides,
      }),
    );
  }

  it('records and retrieves a single tick', async () => {
    const pos = await seedOpenPosition();

    const tick = await service.recordTick({
      copiedPositionId: pos.id,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      outcome: 'Yes',
      bestBid: 0.48,
      bestAsk: 0.52,
      midPrice: 0.5,
      spread: 0.04,
      spreadPercent: 0.08,
      executableBidVwap: 0.479,
      executableAskVwap: 0.521,
      lastTradePrice: 0.505,
    });

    expect(tick.id).toBeGreaterThan(0);
    expect(tick.copiedPositionId).toBe(pos.id);
    expect(tick.midPrice).toBe(0.5);

    const { items } = await service.listByPosition(pos.id);
    expect(items).toHaveLength(1);
    expect(items[0].bestAsk).toBe(0.52);
  });

  it('records a batch for multiple positions on the same asset', async () => {
    const posA = await seedOpenPosition();
    const posB = await seedOpenPosition({ conditionId: 'cond-1', assetId: 'asset-1', outcome: 'No' });

    await service.recordBatch([
      {
        copiedPositionId: posA.id,
        conditionId: 'cond-1',
        assetId: 'asset-1',
        outcome: 'Yes',
        bestBid: 0.49,
        bestAsk: 0.51,
        midPrice: 0.5,
        spread: 0.02,
        spreadPercent: 0.04,
      },
      {
        copiedPositionId: posB.id,
        conditionId: 'cond-1',
        assetId: 'asset-1',
        outcome: 'No',
        bestBid: 0.49,
        bestAsk: 0.51,
        midPrice: 0.5,
        spread: 0.02,
        spreadPercent: 0.04,
      },
    ]);

    const { items: itemsA } = await service.listByPosition(posA.id);
    const { items: itemsB } = await service.listByPosition(posB.id);
    expect(itemsA).toHaveLength(1);
    expect(itemsB).toHaveLength(1);

    const { total } = await service.listByMarket('cond-1');
    expect(total).toBe(2);
  });

  it('lists by market with date and position filters', async () => {
    const pos = await seedOpenPosition();
    await service.recordTick({
      copiedPositionId: pos.id,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      outcome: 'Yes',
      bestBid: 0.5,
      bestAsk: 0.5,
      midPrice: 0.5,
      spread: 0,
      spreadPercent: 0,
    });

    const all = await service.listByMarket('cond-1');
    expect(all.total).toBe(1);

    const byPosition = await service.listByMarket('cond-1', { copiedPositionId: pos.id });
    expect(byPosition.total).toBe(1);

    const empty = await service.listByMarket('cond-1', { copiedPositionId: 99999 });
    expect(empty.total).toBe(0);

    const future = await service.listByMarket('cond-1', { from: new Date(Date.now() + 60_000) });
    expect(future.total).toBe(0);
  });

  it('purges rows older than retention', async () => {
    const pos = await seedOpenPosition();
    const old = await service.recordTick({
      copiedPositionId: pos.id,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      outcome: 'Yes',
      bestBid: 0.5,
      bestAsk: 0.5,
      midPrice: 0.5,
      spread: 0,
      spreadPercent: 0,
    });

    await ds
      .getRepository(MarketPositionTick)
      .createQueryBuilder()
      .update()
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where('id = :id', { id: old.id })
      .execute();

    const deleted = await service.purgeOlderThan(24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);

    const { total } = await service.listByPosition(pos.id);
    expect(total).toBe(0);
  });

  it('accepts null optional VWAP values', async () => {
    const pos = await seedOpenPosition();
    const tick = await service.recordTick({
      copiedPositionId: pos.id,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      outcome: 'Yes',
      bestBid: 0.5,
      bestAsk: 0.5,
      midPrice: 0.5,
      spread: 0,
      spreadPercent: 0,
    });

    expect(tick.executableBidVwap).toBeNull();
    expect(tick.executableAskVwap).toBeNull();
    expect(tick.lastTradePrice).toBeNull();
  });
});
