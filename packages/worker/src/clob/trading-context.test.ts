import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    backendUrl: 'http://backend.test',
    serviceToken: 'tok',
  },
}));

vi.mock('./clob-cache-sync.js', () => ({
  syncDepositWalletCollateralCache: vi.fn().mockResolvedValue(undefined),
}));

import { ensureOrderClobApprovals } from './trading-context.js';
import { syncDepositWalletCollateralCache } from './clob-cache-sync.js';

describe('ensureOrderClobApprovals', () => {
  const clobClient = { signatureType: 3 } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('POSTs only negRisk+side for a weather BUY and skips collateral sync when nothing was granted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ txHash: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureOrderClobApprovals(
      { negRisk: true, side: 'BUY' },
      clobClient,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://backend.test/api/internal/clob-approvals/ensure',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'x-service-token': 'tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ negRisk: true, side: 'BUY' }),
      }),
    );
    expect(syncDepositWalletCollateralCache).not.toHaveBeenCalled();
  });

  it('POSTs standard BUY params (negRisk false) so adapter allowances are not required', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ txHash: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await ensureOrderClobApprovals({ negRisk: false, side: 'BUY' }, clobClient);

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ negRisk: false, side: 'BUY' }),
    );
  });

  it('syncs CLOB matcher cache after a freshly mined approval tx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ txHash: '0xabc' }),
      }),
    );

    await ensureOrderClobApprovals({ negRisk: true, side: 'BUY' }, clobClient);

    expect(syncDepositWalletCollateralCache).toHaveBeenCalledWith(clobClient);
  });

  it('maps HTTP failure to clob_approvals_failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    );

    const result = await ensureOrderClobApprovals({
      negRisk: true,
      side: 'BUY',
    });

    expect(result).toEqual({ ok: false, error: 'clob_approvals_failed' });
    expect(syncDepositWalletCollateralCache).not.toHaveBeenCalled();
  });

  it('maps network failure to clob_approvals_failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const result = await ensureOrderClobApprovals({
      negRisk: false,
      side: 'SELL',
    });

    expect(result).toEqual({ ok: false, error: 'clob_approvals_failed' });
  });
});