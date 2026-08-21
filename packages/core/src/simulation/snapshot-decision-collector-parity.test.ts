import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { seedDefaults } from '../seed/defaults.js';
import {
  SNAPSHOT_DECISION_MAX_EVENTS as REAL_MAX_EVENTS,
  collectRealDecisionPayload,
} from '../real/snapshot-decision-collector.js';
import {
  SNAPSHOT_DECISION_MAX_EVENTS as SIM_MAX_EVENTS,
  collectSimDecisionPayload,
} from './snapshot-decision-collector.js';

describe('snapshot-decision-collector parity (sim vs real)', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('uses identical SNAPSHOT_DECISION_MAX_EVENTS constants', () => {
    expect(SIM_MAX_EVENTS).toBe(REAL_MAX_EVENTS);
    expect(SIM_MAX_EVENTS).toBe(500);
  });

  it('produces matching shared summary fields for equivalent positions', async () => {
    // Use a fixed future date so seeded session/snapshot timestamps (created
    // during seedDefaults from Date.now()) do not push windowFrom past the
    // test events we create below.
    const snapshotAt = new Date('2030-01-15T12:00:00.000Z');
    const eventAt = new Date('2030-01-15T11:30:00.000Z');
    const posRepo = ds.getRepository(CopiedPosition);

    const simPos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        status: 'open',
        mode: 'sim',
        reason: 'ALGO_OPEN',
      }),
    );

    const realPos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c2',
        assetId: 'a2',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        status: 'closed',
        mode: 'real',
        reason: 'ALGO_OPEN',
      }),
    );

    const exitRepo = ds.getRepository(ExitAttemptEvent);
    await exitRepo.save([
      exitRepo.create({
        copiedPositionId: simPos.id,
        mode: 'sim',
        kind: 'emit',
        closeReason: 'tp',
        createdAt: eventAt,
      }),
      exitRepo.create({
        copiedPositionId: realPos.id,
        mode: 'real',
        kind: 'emit',
        closeReason: 'tp',
        createdAt: eventAt,
      }),
    ]);

    const simPayload = await ds.transaction((manager) =>
      collectSimDecisionPayload(manager, {
        algoKind: 'crypto',
        snapshotAt,
        windowHours: 24,
        positions: [simPos],
        watchlistEntries: [],
      }),
    );

    const realPayload = await collectRealDecisionPayload(ds.manager, {
      snapshotAt,
      windowHours: 24,
      positions: [realPos],
      watchlistEntries: [],
    });

    expect(simPayload.exitAttempts[0]).toMatchObject({
      kind: 'emit',
      closeReason: 'tp',
    });
    expect(realPayload.exitAttempts[0]).toMatchObject({
      kind: 'emit',
      closeReason: 'tp',
    });

    expect(simPayload.summary.exitAttemptsByKind).toEqual(realPayload.summary.exitAttemptsByKind);
    expect(simPayload.summary.exitAttemptsByCloseReason).toEqual(
      realPayload.summary.exitAttemptsByCloseReason,
    );
    expect(simPayload.summary.openPositionCount).toBe(1);
    expect(realPayload.summary.closedPositionCount).toBe(1);
    expect(simPayload.summary.truncated).toBe(false);
    expect(realPayload.summary.truncated).toBe(false);
  });
});
