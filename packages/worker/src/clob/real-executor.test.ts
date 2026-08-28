import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OrderType } from '@polymarket/clob-client-v2';
import type { OrderSignal } from '@polywatch/core';
import { RealExecutor } from './real-executor.js';
import { loadTradingContextResult } from './trading-context.js';
import { prepareFakMarketOrder } from './prepare-fak-order.js';
import { withTimeout } from './with-timeout.js';

vi.mock('./trading-context.js', () => ({
  loadTradingContextResult: vi.fn(),
}));

vi.mock('./prepare-fak-order.js', () => ({
  prepareFakMarketOrder: vi.fn(),
}));

vi.mock('./with-timeout.js', () => ({
  withTimeout: vi.fn((_promise, _ms, _label, _signal) => _promise),
}));

function baseSignal(overrides: Partial<OrderSignal> = {}): OrderSignal {
  return {
    id: 'sig-real-1',
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: 'token-1',
    side: 'BUY',
    quantity: 5,
    orderType: 'FOK',
    reason: 'ALGO_OPEN',
    mode: 'real',
    referenceVwap: 0.6,
    ...overrides,
  };
}

describe('RealExecutor order type mapping', () => {
  const createAndPostMarketOrder = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTradingContextResult).mockResolvedValue({
      ok: true,
      context: {
        depositAddress: '0xdep',
        eoaAddress: '0xeoa',
        clobClient: {
          createAndPostMarketOrder,
          signatureType: 3,
          funderAddress: '0xfunder',
        },
        wsAuth: { apiKey: 'k', secret: 's', passphrase: 'p' },
      },
    } as never);
    vi.mocked(prepareFakMarketOrder).mockResolvedValue({
      ok: true,
      prepared: {
        limitPrice: 0.6,
        fillPrice: 0.6,
        usableFillPrice: 0.6,
        tickSize: '0.01',
        negRisk: false,
        platformFeeParams: { feeRateBps: 0, feeExponent: 1 },
        entryBidVwap: 0.58,
      },
    } as never);
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'MATCHED',
      makingAmount: '3',
      takingAmount: '5',
    });
  });

  it('posts FOK market orders when signal.orderType is FOK', async () => {
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    await executor.execute(baseSignal(), connectionManager);

    expect(createAndPostMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: OrderType.FOK }),
      expect.anything(),
      OrderType.FOK,
    );
  });

  it('posts FAK market orders when signal.orderType is FAK', async () => {
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    await executor.execute(
      baseSignal({ orderType: 'FAK', reason: 'COPY_OPEN' }),
      connectionManager,
    );

    expect(createAndPostMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: OrderType.FAK }),
      expect.anything(),
      OrderType.FAK,
    );
  });

  it('maps GTC signals to FAK (CLOB market-order path has no resting GTC)', async () => {
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    await executor.execute(
      baseSignal({ orderType: 'GTC', reason: 'WEATHER_OPEN' }),
      connectionManager,
    );

    expect(createAndPostMarketOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: OrderType.FAK }),
      expect.anything(),
      OrderType.FAK,
    );
  });

  it('force-refreshes the book before prepareFakMarketOrder', async () => {
    const order: string[] = [];
    const forceRefreshBook = vi.fn(async () => {
      order.push('refresh');
      return { asks: [], bids: [] };
    });
    vi.mocked(prepareFakMarketOrder).mockImplementation(async () => {
      order.push('prepare');
      return {
        ok: true,
        prepared: {
          limitPrice: 0.6,
          fillPrice: 0.6,
          usableFillPrice: 0.6,
          tickSize: '0.01',
          negRisk: false,
          platformFeeParams: { feeRateBps: 0, feeExponent: 1 },
          entryBidVwap: 0.58,
        },
      } as never;
    });

    const executor = new RealExecutor();
    await executor.execute(baseSignal({ orderType: 'FAK' }), {
      forceRefreshBook,
      getOrderBook: vi.fn(),
    } as never);

    expect(forceRefreshBook).toHaveBeenCalledWith('token-1');
    expect(order).toEqual(['refresh', 'prepare']);
  });
});
