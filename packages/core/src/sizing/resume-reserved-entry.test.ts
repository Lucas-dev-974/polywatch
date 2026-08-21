import { describe, expect, it, vi } from 'vitest';
import { resumeEntryFromReservation } from './resume-reserved-entry.js';
import { ENTRY_MOS_SKIP_CANNOT_BUMP } from './entry-mos.js';

function mockExecutablePrices(executableAskVwap = 0.6, executableBidVwap = 0.58) {
  return {
    executableAskVwap,
    executableBidVwap,
    askLiquidityStatus: 'ok' as const,
  };
}

describe('resumeEntryFromReservation', () => {
  it('abandons when derived qty is below effective MOS', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const enqueueUnique = vi.fn().mockResolvedValue(true);
    const fetchExecutablePrices = vi.fn().mockResolvedValue(mockExecutablePrices());

    const result = await resumeEntryFromReservation({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      mode: 'sim',
      signalId: 'sig-1',
      reason: 'ALGO_OPEN',
      reservation: {
        reservedNotionalUsdc: 2,
        reservationId: 10,
        copiedPositionId: 1,
        expiresAt: new Date(Date.now() + 120_000),
        orderSignalId: 'sig-1',
      },
      connectionManager: { fetchExecutablePrices },
      reservationService: { release } as any,
      orderQueue: { enqueueUnique } as any,
      resolveEffectiveEntryMos: async () => 5,
    });

    expect(result).toBe(ENTRY_MOS_SKIP_CANNOT_BUMP);
    expect(release).toHaveBeenCalledWith(
      'sig-1',
      'resume_abandoned:Quantité sous le minimum marché (MOS), bump impossible',
    );
    expect(enqueueUnique).not.toHaveBeenCalled();
  });

  it('defers abandon when a BUY is still in flight', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const enqueueUnique = vi.fn().mockResolvedValue(true);

    const result = await resumeEntryFromReservation({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      mode: 'sim',
      signalId: 'sig-1',
      reason: 'ALGO_OPEN',
      reservation: {
        reservedNotionalUsdc: 2,
        reservationId: 10,
        copiedPositionId: 1,
        expiresAt: new Date(Date.now() + 120_000),
        orderSignalId: 'sig-1',
      },
      connectionManager: {
        fetchExecutablePrices: vi.fn().mockResolvedValue(mockExecutablePrices()),
      },
      reservationService: { release } as any,
      orderQueue: { enqueueUnique, enqueue: vi.fn() } as any,
      resolveEffectiveEntryMos: async () => 5,
      hasInFlightBuy: async () => true,
    });

    expect(result).toBeNull();
    expect(release).not.toHaveBeenCalled();
  });

  it('re-enqueues via enqueueUnique keyed on the signal id', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const enqueueUnique = vi.fn().mockResolvedValue(true);

    const result = await resumeEntryFromReservation({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      mode: 'sim',
      signalId: 'sig-1',
      reason: 'ALGO_OPEN',
      reservation: {
        reservedNotionalUsdc: 6,
        reservationId: 10,
        copiedPositionId: 1,
        expiresAt: new Date(Date.now() + 120_000),
        orderSignalId: 'sig-1',
      },
      connectionManager: {
        fetchExecutablePrices: vi.fn().mockResolvedValue(mockExecutablePrices()),
      },
      reservationService: { release } as any,
      orderQueue: { enqueueUnique, enqueue: vi.fn() } as any,
      resolveEffectiveEntryMos: async () => 5,
    });

    expect(result).toBeNull();
    expect(release).not.toHaveBeenCalled();
    expect(enqueueUnique).toHaveBeenCalledTimes(1);
    const [job, key, ttl] = enqueueUnique.mock.calls[0];
    expect(job).toMatchObject({
      id: 'sig-1',
      reason: 'ALGO_OPEN',
      side: 'BUY',
      orderType: 'FOK',
    });
    expect(key).toBe('sig-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('keeps FAK order type for copy resume', async () => {
    const enqueueUnique = vi.fn().mockResolvedValue(true);

    await resumeEntryFromReservation({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      mode: 'sim',
      signalId: 'sig-copy',
      reason: 'COPY_OPEN',
      reservation: {
        reservedNotionalUsdc: 6,
        reservationId: 10,
        copiedPositionId: 1,
        expiresAt: new Date(Date.now() + 120_000),
        orderSignalId: 'sig-copy',
      },
      connectionManager: {
        fetchExecutablePrices: vi.fn().mockResolvedValue(mockExecutablePrices()),
      },
      reservationService: { release: vi.fn() } as any,
      orderQueue: { enqueueUnique, enqueue: vi.fn() } as any,
    });

    const [job] = enqueueUnique.mock.calls[0];
    expect(job.orderType).toBe('FAK');
  });
});
