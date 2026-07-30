import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoveDetector } from './move-detector.js';
import type { DataSource } from 'typeorm';
import { CopyConfigService, type RedisQueue, type MoveEventDto } from '@polywatch/core';

vi.mock('@polywatch/core', async () => {
  const actual = await vi.importActual('@polywatch/core');
  return {
    ...actual,
    CopyConfigService: vi.fn().mockImplementation(() => ({
      getConfig: vi.fn().mockResolvedValue({
        simCopyTradingEnabled: true,
        realCopyTradingEnabled: true,
      }),
    })),
    PollCycleService: vi.fn().mockImplementation(() => ({
      runPollCycle: vi.fn().mockResolvedValue([]),
      reconcile: vi.fn().mockResolvedValue([]),
    })),
    MoveEventService: vi.fn().mockImplementation(() => ({
      loadUnprocessed: vi.fn().mockResolvedValue([]),
      loadProcessedWithStalePending: vi.fn(),
      resetProcessed: vi.fn().mockResolvedValue(undefined),
    })),
    WatchlistService: vi.fn().mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue([]),
    })),
  };
});

vi.mock('../polymarket/api-client.js', () => ({
  fetchTraderPositions: vi.fn(),
}));

vi.mock('../notify/backend-notify.js', () => ({
  notifyMoveEventsChanged: vi.fn(),
}));

vi.mock('../backend-client.js', () => ({
  postBackendJson: vi.fn(),
}));

describe('MoveDetector', () => {
  let detector: MoveDetector;
  let moveQueue: RedisQueue<MoveEventDto>;
  let ds: DataSource;

  beforeEach(() => {
    ds = {} as DataSource;
    moveQueue = { enqueue: vi.fn() } as unknown as RedisQueue<MoveEventDto>;
    const copyConfigService = new CopyConfigService(ds);
    detector = new MoveDetector(ds, moveQueue, copyConfigService);
  });

  describe('recoverOrphanMoves', () => {
    it('re-enqueues stale processed moves with orphan pending positions', async () => {
      const staleMoves = [
        {
          id: 'stale-1',
          traderAddress: '0xtrader',
          conditionId: '0xcond',
          assetId: '0xasset',
          outcome: 'YES',
          eventType: 'OPENED',
          traderSize: 100,
          traderAvgPrice: 0.5,
          previousTraderSize: 0,
          detectedAt: new Date(),
        },
        {
          id: 'stale-2',
          traderAddress: '0xtrader2',
          conditionId: '0xcond2',
          assetId: '0xasset2',
          outcome: 'NO',
          eventType: 'INCREASED',
          traderSize: 200,
          traderAvgPrice: 0.3,
          previousTraderSize: 100,
          detectedAt: new Date(),
        },
      ];

      const moveEventService = (detector as any).moveEventService;
      moveEventService.loadProcessedWithStalePending.mockResolvedValue(staleMoves);

      await detector.recoverOrphanMoves();

      expect(moveEventService.resetProcessed).toHaveBeenCalledWith(['stale-1', 'stale-2']);
      expect(moveQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(moveQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stale-1' }),
      );
      expect(moveQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stale-2' }),
      );
    });

    it('does nothing when no stale moves exist', async () => {
      const moveEventService = (detector as any).moveEventService;
      moveEventService.loadProcessedWithStalePending.mockResolvedValue([]);

      await detector.recoverOrphanMoves();

      expect(moveEventService.resetProcessed).not.toHaveBeenCalled();
    });
  });

  describe('runCycle copy-trading toggle', () => {
    it('stops polling when copy trading is disabled', async () => {
      const copyConfigService = (detector as any).copyConfigService;
      copyConfigService.getConfig.mockResolvedValue({
        simCopyTradingEnabled: false,
        realCopyTradingEnabled: false,
      });

      detector.startPolling();
      // Wait for the async cycle to complete.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(detector.isRunning()).toBe(false);
      expect((detector as any).stopped).toBe(true);
    });
  });
});
