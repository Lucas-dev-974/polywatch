import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OrderSignal } from '@polywatch/core';
import { Executor } from './executor.js';
import { prepareFakMarketOrder } from '../clob/prepare-fak-order.js';
import { sampleLatencyMs } from '../execution/latency-calibrator.js';
import { sleepUnlessAborted } from '../helpers/sleep-unless-aborted.js';
import {
  getSelfImpactRegistry,
  resetSelfImpactRegistryForTests,
} from '../execution/self-impact-registry.js';
import { makeGlobalConfig } from './strategy/test-config-fixtures.js';

vi.mock('../clob/prepare-fak-order.js', () => ({
  prepareFakMarketOrder: vi.fn(),
}));

vi.mock('../execution/latency-calibrator.js', () => ({
  sampleLatencyMs: vi.fn(),
}));

vi.mock('../helpers/sleep-unless-aborted.js', () => ({
  sleepUnlessAborted: vi.fn(),
}));

function baseSignal(overrides: Partial<OrderSignal> = {}): OrderSignal {
  return {
    id: 'sig-sim-fok',
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: 'token-fok',
    side: 'BUY',
    quantity: 5,
    orderType: 'FOK',
    reason: 'ALGO_OPEN',
    mode: 'sim',
    referenceVwap: 0.6,
    ...overrides,
  };
}

const prepared = {
  limitPrice: 0.6,
  fillPrice: 0.6,
  usableFillPrice: 0.6,
  tickSize: '0.01' as const,
  negRisk: false,
  platformFeeParams: { feeRateBps: 0, feeExponent: 1 },
  entryBidVwap: 0.58,
};

describe('Executor simulateFill FOK', () => {
  let executor: Executor;
  let connectionManager: {
    forceRefreshBook: ReturnType<typeof vi.fn>;
    getOrderBook: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSelfImpactRegistryForTests();

    connectionManager = {
      forceRefreshBook: vi.fn(),
      getOrderBook: vi.fn().mockReturnValue(null),
    };

    executor = new Executor(
      {} as any,
      connectionManager as any,
      { enqueue: vi.fn() } as any,
      {
        runSequentially: vi.fn(),
      } as any,
    );

    (executor as any).globalConfigService = {
      getConfig: vi.fn().mockResolvedValue(
        makeGlobalConfig({
          simSelfImpactEnabled: true,
          simSelfImpactTtlSeconds: 8,
          simExecLatencyMs: 0,
        }),
      ),
    };

    vi.mocked(prepareFakMarketOrder).mockResolvedValue({
      ok: true,
      prepared,
    } as never);
    vi.mocked(sampleLatencyMs).mockResolvedValue(0);
    vi.mocked(sleepUnlessAborted).mockResolvedValue(true);
  });

  it('rejects partial fill for FOK with order_not_matched', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 2 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    const result = await (executor as any).simulateFill(
      baseSignal(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: 'order_not_matched',
    });
  });

  it('does not record self-impact when FOK partial is rejected', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 2 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    await (executor as any).simulateFill(baseSignal(), new AbortController().signal);

    const registry = getSelfImpactRegistry(8);
    const untouched = registry.applyImpact('token-fok', 'BUY', [
      { price: 0.6, size: 5 },
    ]);
    expect(untouched).toEqual([{ price: 0.6, size: 5 }]);

    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 5 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    const result = await (executor as any).simulateFill(
      baseSignal({ id: 'sig-sim-fok-2' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'filled',
      fillQuantity: 5,
    });
  });

  it('accepts full fill for FOK', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 10 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    const result = await (executor as any).simulateFill(
      baseSignal(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'filled',
      fillQuantity: 5,
    });
  });

  it('rejects partial fill for FAK with order_not_matched', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 2 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    const result = await (executor as any).simulateFill(
      baseSignal({ orderType: 'FAK', reason: 'COPY_OPEN' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: 'order_not_matched',
    });
  });

  it('rejects empty T1 book with order_not_matched', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [],
      bids: [],
    });

    const result = await (executor as any).simulateFill(
      baseSignal({ orderType: 'FAK', reason: 'WEATHER_OPEN' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: 'order_not_matched',
    });
  });

  it('rejects asks that do not cross the FAK limit', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.7, size: 100 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    const result = await (executor as any).simulateFill(
      baseSignal({ orderType: 'FAK', reason: 'WEATHER_OPEN' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: 'order_not_matched',
    });
  });

  it('refreshes the book before prepare and again at T1', async () => {
    connectionManager.forceRefreshBook.mockResolvedValue({
      asks: [{ price: 0.6, size: 10 }],
      bids: [{ price: 0.58, size: 10 }],
    });

    await (executor as any).simulateFill(
      baseSignal({ orderType: 'FAK', reason: 'WEATHER_OPEN' }),
      new AbortController().signal,
    );

    expect(connectionManager.forceRefreshBook).toHaveBeenCalledWith('token-fok');
    expect(connectionManager.forceRefreshBook).toHaveBeenCalledTimes(2);
    expect(prepareFakMarketOrder).toHaveBeenCalled();
  });
});
