import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OrderSignal } from '@polywatch/core';
import { runSimWalletPreflight } from './sim-wallet-preflight.js';
import { loadTradingContextResult } from '../clob/trading-context.js';
import { fetchRealPusdBalance } from '../sizing/real-balance-cache.js';

vi.mock('../clob/trading-context.js', () => ({
  loadTradingContextResult: vi.fn(),
}));

vi.mock('../sizing/real-balance-cache.js', () => ({
  fetchRealPusdBalance: vi.fn(),
}));

function buySignal(quantity = 10): OrderSignal {
  return {
    id: 'sig-1',
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: 'token-1',
    side: 'BUY',
    quantity,
    orderType: 'FAK',
    reason: 'ENTRY',
    mode: 'sim',
    referenceVwap: 0.5,
  };
}

describe('runSimWalletPreflight', () => {
  beforeEach(() => {
    vi.mocked(loadTradingContextResult).mockReset();
    vi.mocked(fetchRealPusdBalance).mockReset();
  });

  it('skips SELL signals', async () => {
    const result = await runSimWalletPreflight(
      { ...buySignal(), side: 'SELL' },
      5,
    );
    expect(result).toBeNull();
    expect(loadTradingContextResult).not.toHaveBeenCalled();
  });

  it('skips when trading context is unavailable', async () => {
    vi.mocked(loadTradingContextResult).mockResolvedValue({
      ok: false,
      error: 'no_credentials',
    });
    const result = await runSimWalletPreflight(buySignal(), 5);
    expect(result).toBeNull();
    expect(fetchRealPusdBalance).not.toHaveBeenCalled();
  });

  it('returns insufficient_balance when balance is too low', async () => {
    vi.mocked(loadTradingContextResult).mockResolvedValue({ ok: true } as never);
    vi.mocked(fetchRealPusdBalance).mockResolvedValue(4.99);
    const result = await runSimWalletPreflight(buySignal(), 5);
    expect(result).toEqual({ ok: false, error: 'insufficient_balance' });
  });

  it('returns ok when balance covers the market amount', async () => {
    vi.mocked(loadTradingContextResult).mockResolvedValue({ ok: true } as never);
    vi.mocked(fetchRealPusdBalance).mockResolvedValue(100);
    const result = await runSimWalletPreflight(buySignal(), 5);
    expect(result).toEqual({ ok: true });
  });
});
