import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyEntryMosGate } from './apply-entry-mos-gate.js';
import {
  ENTRY_MOS_SKIP_CANNOT_BUMP,
  ENTRY_MOS_SKIP_NO_LIQUIDITY_BUMP,
} from './entry-mos.js';
import * as resolveEntryMos from './resolve-entry-mos.js';

describe('applyEntryMosGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const connectionManager = {
    fetchExecutablePrices: vi.fn(),
  };

  it('passes through when qty meets MOS from book', async () => {
    vi.spyOn(resolveEntryMos, 'resolveEntryMinOrderSharesDetailed').mockResolvedValue({
      minShares: 5,
      source: 'book',
    });

    const result = await applyEntryMosGate({
      targetQty: 6,
      askVwap: 0.6,
      cash: 100,
      maxPositionSizePusd: 50,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      clobApi: 'https://clob.test',
      connectionManager,
    });

    expect(result).toEqual({
      ok: true,
      quantity: 6,
      askVwap: 0.6,
      bumped: false,
      effectiveMos: 5,
    });
    expect(connectionManager.fetchExecutablePrices).not.toHaveBeenCalled();
  });

  it('bumps and re-fetches ask VWAP when qty below MOS', async () => {
    vi.spyOn(resolveEntryMos, 'resolveEntryMinOrderSharesDetailed').mockResolvedValue({
      minShares: 5,
      source: 'book',
    });
    connectionManager.fetchExecutablePrices.mockResolvedValue({
      executableAskVwap: 0.62,
      executableBidVwap: 0.6,
    });

    const result = await applyEntryMosGate({
      targetQty: 3.33,
      askVwap: 0.6,
      cash: 100,
      maxPositionSizePusd: 50,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      clobApi: 'https://clob.test',
      connectionManager,
    });

    expect(result).toEqual({
      ok: true,
      quantity: 5,
      askVwap: 0.62,
      bumped: true,
      effectiveMos: 5,
    });
    expect(connectionManager.fetchExecutablePrices).toHaveBeenCalledWith(
      'asset-1',
      5,
    );
  });

  it('uses conservative floor when MOS lookup fails and bump impossible', async () => {
    vi.spyOn(resolveEntryMos, 'resolveEntryMinOrderSharesDetailed').mockResolvedValue({
      minShares: 1,
      source: 'fallback',
    });

    const result = await applyEntryMosGate({
      targetQty: 3,
      askVwap: 0.6,
      cash: 2,
      maxPositionSizePusd: 50,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      clobApi: 'https://clob.test',
      connectionManager,
    });

    expect(result).toEqual({ ok: false, skipReason: ENTRY_MOS_SKIP_CANNOT_BUMP });
  });

  it('skips when post-bump ask VWAP exceeds cash or position cap', async () => {
    vi.spyOn(resolveEntryMos, 'resolveEntryMinOrderSharesDetailed').mockResolvedValue({
      minShares: 5,
      source: 'book',
    });
    connectionManager.fetchExecutablePrices.mockResolvedValue({
      executableAskVwap: 0.7,
      executableBidVwap: 0.68,
    });

    const result = await applyEntryMosGate({
      targetQty: 3.33,
      askVwap: 0.6,
      cash: 3,
      maxPositionSizePusd: 50,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      clobApi: 'https://clob.test',
      connectionManager,
    });

    expect(result).toEqual({ ok: false, skipReason: ENTRY_MOS_SKIP_CANNOT_BUMP });
  });

  it('skips when bumped qty has no ask liquidity', async () => {
    vi.spyOn(resolveEntryMos, 'resolveEntryMinOrderSharesDetailed').mockResolvedValue({
      minShares: 5,
      source: 'book',
    });
    connectionManager.fetchExecutablePrices.mockResolvedValue({
      executableAskVwap: 0,
      executableBidVwap: 0,
    });

    const result = await applyEntryMosGate({
      targetQty: 3,
      askVwap: 0.6,
      cash: 100,
      maxPositionSizePusd: 50,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      clobApi: 'https://clob.test',
      connectionManager,
    });

    expect(result).toEqual({
      ok: false,
      skipReason: ENTRY_MOS_SKIP_NO_LIQUIDITY_BUMP,
    });
  });
});
