import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { IPolymarketConnectionManager, MoveEventDto, OrderSignal, RedisQueue } from '@polywatch/core';
import { CopyProcessor } from './copy-processor.js';

const markProcessedWithReasons = vi.fn().mockResolvedValue(undefined);
const findByTraderAddress = vi.fn();
const findById = vi.fn();
const getCopyConfig = vi.fn();
const getGlobalConfig = vi.fn();

vi.mock('@polywatch/core', async () => {
  const actual = await vi.importActual('@polywatch/core');
  return {
    ...actual,
    ReservationService: vi.fn(),
    WatchlistService: vi.fn().mockImplementation(() => ({
      findByTraderAddress,
    })),
    MoveEventService: vi.fn().mockImplementation(() => ({
      findById,
      markProcessedWithReasons,
    })),
    CopyConfigService: vi.fn().mockImplementation(() => ({
      getConfig: getCopyConfig,
    })),
    GlobalConfigService: vi.fn().mockImplementation(() => ({
      getConfig: getGlobalConfig,
    })),
    SimulationService: vi.fn(),
    MarketService: vi.fn(),
  };
});

vi.mock('../notify/backend-notify.js', () => ({
  notifyMoveEventsChanged: vi.fn(),
}));

vi.mock('../polymarket/pending-move-assets.js', () => ({
  registerPendingMoveAsset: vi.fn(),
}));

const move: MoveEventDto = {
  id: 'move-1',
  traderAddress: '0xtrader',
  conditionId: '0xcond',
  assetId: '0xasset',
  outcome: 'YES',
  type: 'OPENED',
  traderSize: 100,
  traderAvgPrice: 0.5,
  previousTraderSize: 0,
  detectedAt: new Date(),
  marketMeta: { title: 'Test market', endDate: '2026-12-31T00:00:00Z', negativeRisk: false },
};

const entry = {
  id: 1,
  traderAddress: '0xtrader',
  active: true,
  simEnabled: true,
  realEnabled: true,
};

describe('CopyProcessor.handle', () => {
  let processor: CopyProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    findByTraderAddress.mockResolvedValue(entry);
    findById.mockResolvedValue(null);
    getCopyConfig.mockResolvedValue({
      simCopyTradingEnabled: true,
      realCopyTradingEnabled: true,
    });
    getGlobalConfig.mockResolvedValue({ realTradingEnabled: true });

    processor = new CopyProcessor(
      {} as DataSource,
      {} as IPolymarketConnectionManager,
      {} as RedisQueue<OrderSignal>,
    );
  });

  it('does not mark processed when a mode throws (Q1=a)', async () => {
    const processMode = vi
      .spyOn(processor as unknown as { processMode: () => Promise<unknown> }, 'processMode')
      .mockRejectedValueOnce(new Error('transient db'))
      .mockResolvedValueOnce({ kind: 'ok' });

    await expect(processor.handle(move)).rejects.toThrow('copy_process_mode_error:move-1');

    expect(processMode).toHaveBeenCalledTimes(2);
    expect(markProcessedWithReasons).not.toHaveBeenCalled();
  });

  it('marks processed when all modes complete without throw', async () => {
    vi.spyOn(processor as unknown as { processMode: () => Promise<unknown> }, 'processMode')
      .mockResolvedValueOnce({ kind: 'skip', reason: 'Cash simulation insuffisant' })
      .mockResolvedValueOnce({ kind: 'ok' });

    await processor.handle(move);

    expect(markProcessedWithReasons).toHaveBeenCalledWith(
      ['move-1'],
      expect.objectContaining({
        sim: 'Cash simulation insuffisant',
      }),
    );
  });
});
