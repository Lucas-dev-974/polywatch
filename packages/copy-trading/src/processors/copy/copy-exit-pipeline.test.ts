import { describe, it, expect, vi } from 'vitest';
import { runCopyExitPipeline } from './copy-exit-pipeline.js';
import type { MoveEventDto, OrderSignal, TradingMode, RedisQueue, IPolymarketConnectionManager } from '@polywatch/core';
import type { DataSource } from 'typeorm';

vi.mock('../../clob/min-order-shares.js', () => ({
  resolveMinOrderShares: vi.fn(),
}));

import { resolveMinOrderShares } from '../../clob/min-order-shares.js';

function makeMove(overrides: Partial<MoveEventDto> = {}): MoveEventDto {
  return {
    id: 'move-1',
    traderAddress: '0xtrader',
    conditionId: '0xcond',
    assetId: '0xasset',
    outcome: 'YES',
    type: 'DECREASED',
    traderSize: 200,
    previousTraderSize: 300,
    traderAvgPrice: 0.5,
    detectedAt: new Date(),
    marketMeta: { title: '', endDate: '', negativeRisk: false },
    ...overrides,
  };
}

function makeEntry() {
  return {
    id: 1,
    traderAddress: '0xtrader',
    nickname: 'trader',
    active: true,
    simEnabled: true,
    realEnabled: false,
  };
}

describe('runCopyExitPipeline', () => {
  it('skips COPY_DECREASE when sell quantity is below min order size', async () => {
    vi.mocked(resolveMinOrderShares).mockResolvedValue(50);

    const move = makeMove({ type: 'DECREASED', previousTraderSize: 300, traderSize: 200 });
    const entry = makeEntry();
    const orderQueue = { enqueue: vi.fn() } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = {
      fetchExecutablePrices: vi.fn().mockResolvedValue({ executableBidVwap: 0.4 }),
    } as unknown as IPolymarketConnectionManager;
    const ds = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({
          id: 1,
          quantity: 100,
          conditionId: '0xcond',
          assetId: '0xasset',
          mode: 'sim',
        }),
      }),
    } as unknown as DataSource;

    const result = await runCopyExitPipeline({
      ds,
      move,
      entry: entry as any,
      mode: 'sim' as TradingMode,
      connectionManager,
      orderQueue,
    });

    expect(result).toBe('Quantité de sortie sous le minimum marché');
    expect(orderQueue.enqueue).not.toHaveBeenCalled();
  });

  it('allows COPY_CLOSED regardless of min order size', async () => {
    vi.mocked(resolveMinOrderShares).mockResolvedValue(50);

    const move = makeMove({ type: 'CLOSED', previousTraderSize: 300, traderSize: 0 });
    const entry = makeEntry();
    const orderQueue = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = {
      fetchExecutablePrices: vi.fn().mockResolvedValue({ executableBidVwap: 0.4 }),
    } as unknown as IPolymarketConnectionManager;
    const ds = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({
          id: 1,
          quantity: 100,
          conditionId: '0xcond',
          assetId: '0xasset',
          mode: 'sim',
        }),
      }),
    } as unknown as DataSource;

    const result = await runCopyExitPipeline({
      ds,
      move,
      entry: entry as any,
      mode: 'sim' as TradingMode,
      connectionManager,
      orderQueue,
    });

    expect(result).toBeNull();
    expect(orderQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});
