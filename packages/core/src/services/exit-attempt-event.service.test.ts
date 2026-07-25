import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { seedDefaults } from '../seed/defaults.js';
import {
  CopiedPositionService,
  EXIT_EMIT_BLOCK_RECORD_THROTTLE_MS,
} from './copied-position.service.js';
import { ExitAttemptEventService } from './exit-attempt-event.service.js';

describe('CopiedPositionService exit attempt journal', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let positionService: CopiedPositionService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    positionService = new CopiedPositionService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function createOpenPosition(): Promise<CopiedPosition> {
    const repo = ds.getRepository(CopiedPosition);
    return repo.save(
      repo.create({
        watchlistId: 1,
        conditionId: 'c-journal',
        assetId: 'a1',
        outcome: 'Up',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
      }),
    );
  }

  it('records emit_blocked journal rows with the same throttle as counters', async () => {
    const pos = await createOpenPosition();
    const t0 = new Date('2026-07-09T12:00:00.000Z');

    await positionService.recordExitEmitBlock(pos.id, {
      blockReason: 'no_close_bid',
      closeReason: 'SL',
      markBid: 0.42,
      now: t0,
    });

    const attemptRepo = ds.getRepository(ExitAttemptEvent);
    expect(await attemptRepo.count({ where: { copiedPositionId: pos.id } })).toBe(
      1,
    );
    const first = await attemptRepo.findOneByOrFail({
      copiedPositionId: pos.id,
    });
    expect(first.markBid).toBeCloseTo(0.42);

    await positionService.recordExitEmitBlock(pos.id, {
      blockReason: 'no_close_bid',
      closeReason: 'SL',
      now: new Date(t0.getTime() + EXIT_EMIT_BLOCK_RECORD_THROTTLE_MS - 1),
    });
    expect(await attemptRepo.count({ where: { copiedPositionId: pos.id } })).toBe(
      1,
    );

    await positionService.recordExitEmitBlock(pos.id, {
      blockReason: 'no_close_bid',
      closeReason: 'SL',
      now: new Date(t0.getTime() + EXIT_EMIT_BLOCK_RECORD_THROTTLE_MS),
    });
    expect(await attemptRepo.count({ where: { copiedPositionId: pos.id } })).toBe(
      2,
    );

    const updated = await ds.getRepository(CopiedPosition).findOneByOrFail({
      id: pos.id,
    });
    expect(updated.exitEmitBlockedCount).toBe(2);

    await positionService.clearExitEmitBlock(pos.id);
    const cleared = await ds.getRepository(CopiedPosition).findOneByOrFail({
      id: pos.id,
    });
    expect(cleared.exitEmitBlockedCount).toBe(0);
    expect(
      await attemptRepo.count({ where: { copiedPositionId: pos.id } }),
    ).toBe(2);
  });

  it('lists attempts chronologically with a bounded limit', async () => {
    const pos = await createOpenPosition();
    const service = new ExitAttemptEventService(ds);
    const t0 = new Date('2026-07-09T12:00:00.000Z');

    await positionService.recordExitEmitBlock(pos.id, {
      blockReason: 'no_close_bid',
      closeReason: 'SL',
      now: t0,
    });
    await positionService.recordExitEmitBlock(pos.id, {
      blockReason: 'no_close_bid',
      closeReason: 'TP',
      now: new Date(t0.getTime() + 10_000),
    });

    const page = await service.listByPosition(pos.id, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.closeReason).toBe('SL');

    const rest = await service.listByPosition(pos.id, { limit: 10, offset: 1 });
    expect(rest.items).toHaveLength(1);
    expect(rest.items[0]!.closeReason).toBe('TP');
  });
});
