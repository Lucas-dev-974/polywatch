import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OrderType } from '@polymarket/clob-client-v2';
import type { OrderSignal } from '@polywatch/core';
import { RealExecutor } from './real-executor.js';
import { loadTradingContextResult, clearTradingContextCache, ensureOrderClobApprovals } from './trading-context.js';
import { prepareFakMarketOrder } from './prepare-fak-order.js';
import { withTimeout } from './with-timeout.js';

vi.mock('./trading-context.js', () => ({
  loadTradingContextResult: vi.fn(),
  clearTradingContextCache: vi.fn(),
  ensureOrderClobApprovals: vi.fn(),
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
    vi.mocked(ensureOrderClobApprovals).mockResolvedValue({ ok: true });
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

  it('maps a rejected CLOB response to clob_rejected:<reason>', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'REJECTED',
      makingAmount: '0',
      takingAmount: '0',
      errorMsg: 'INSUFFICIENT_BALANCE',
    });
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('clob_rejected:INSUFFICIENT_BALANCE');
    expect(clearTradingContextCache).not.toHaveBeenCalled();
  });

  it('maps INSUFFICIENT_ALLOWANCE error to insufficient_allowance', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'unmatched',
      makingAmount: '0',
      takingAmount: '0',
      errorMsg: 'INSUFFICIENT_ALLOWANCE',
    });
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('insufficient_allowance');
    expect(clearTradingContextCache).toHaveBeenCalled();
  });

  it('maps "allowance is not enough" error to insufficient_allowance (CLOB V2 descriptive message)', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'unmatched',
      makingAmount: '0',
      takingAmount: '0',
      errorMsg: 'not enough balance / allowance: the allowance is not enough -> spender: 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296, allowance: 0',
    });
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('insufficient_allowance');
  });

  it('maps an HTTP error response to clob_rejected with the error detail', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'unmatched',
      makingAmount: '0',
      takingAmount: '0',
      error: 'MINIMUM_ORDER_SIZE',
    });
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('clob_rejected:');
    expect(result?.error).toContain('MINIMUM_ORDER_SIZE');
  });

  it('keeps order_not_matched exact for a genuine FAK kill', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'unmatched',
      makingAmount: '0',
      takingAmount: '0',
      errorMsg: 'No orders found to match with FAK',
    });
    const executor = new RealExecutor();
    const connectionManager = {
      getOrderBook: vi.fn(),
    } as never;

    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('order_not_matched');
  });

  it('maps REJECTED + allowance errorMsg to insufficient_allowance and clears cache', async () => {
    createAndPostMarketOrder.mockResolvedValue({
      orderID: 'ord-1',
      status: 'REJECTED',
      makingAmount: '0',
      takingAmount: '0',
      errorMsg: 'the allowance is not enough',
    });
    const executor = new RealExecutor();
    const connectionManager = { getOrderBook: vi.fn() } as never;
    const result = await executor.execute(baseSignal(), connectionManager);
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('insufficient_allowance');
    expect(clearTradingContextCache).toHaveBeenCalled();
  });

  it('ensures only weather BUY allowances before posting a neg-risk WEATHER_OPEN', async () => {
    vi.mocked(prepareFakMarketOrder).mockResolvedValue({
      ok: true,
      prepared: {
        limitPrice: 0.6,
        fillPrice: 0.6,
        usableFillPrice: 0.6,
        tickSize: '0.01',
        negRisk: true,
        platformFeeParams: { feeRateBps: 0, feeExponent: 1 },
        entryBidVwap: 0.58,
      },
    } as never);
    const executor = new RealExecutor();
    const connectionManager = { getOrderBook: vi.fn() } as never;
    await executor.execute(
      baseSignal({ reason: 'WEATHER_OPEN', orderType: 'FAK' }),
      connectionManager,
    );
    expect(ensureOrderClobApprovals).toHaveBeenCalledWith(
      { negRisk: true, side: 'BUY' },
      expect.objectContaining({ createAndPostMarketOrder }),
    );
    expect(createAndPostMarketOrder).toHaveBeenCalled();
  });

  it('ensures only standard BUY allowances before posting a copy BUY', async () => {
    const executor = new RealExecutor();
    const connectionManager = { getOrderBook: vi.fn() } as never;
    await executor.execute(
      baseSignal({ reason: 'COPY_OPEN', orderType: 'FAK' }),
      connectionManager,
    );
    expect(ensureOrderClobApprovals).toHaveBeenCalledWith(
      { negRisk: false, side: 'BUY' },
      expect.objectContaining({ createAndPostMarketOrder }),
    );
    expect(createAndPostMarketOrder).toHaveBeenCalled();
  });

  it('ensures weather SELL allowances before posting a neg-risk SELL', async () => {
    vi.mocked(prepareFakMarketOrder).mockResolvedValue({
      ok: true,
      prepared: {
        limitPrice: 0.6,
        fillPrice: 0.6,
        usableFillPrice: 0.6,
        tickSize: '0.01',
        negRisk: true,
        platformFeeParams: { feeRateBps: 0, feeExponent: 1 },
        entryBidVwap: 0.58,
      },
    } as never);
    const executor = new RealExecutor();
    const connectionManager = { getOrderBook: vi.fn() } as never;
    await executor.execute(
      baseSignal({ side: 'SELL', reason: 'WEATHER_BUCKET_EXIT', orderType: 'FAK' }),
      connectionManager,
    );
    expect(ensureOrderClobApprovals).toHaveBeenCalledWith(
      { negRisk: true, side: 'SELL' },
      expect.anything(),
    );
  });

  it('does not post when required CLOB approvals cannot be granted', async () => {
    vi.mocked(ensureOrderClobApprovals).mockResolvedValue({
      ok: false,
      error: 'clob_approvals_failed',
    });
    const executor = new RealExecutor();
    const connectionManager = { getOrderBook: vi.fn() } as never;
    const result = await executor.execute(
      baseSignal({ reason: 'WEATHER_OPEN' }),
      connectionManager,
    );
    expect(result?.status).toBe('failed');
    expect(result?.error).toBe('clob_approvals_failed');
    expect(createAndPostMarketOrder).not.toHaveBeenCalled();
  });
});
