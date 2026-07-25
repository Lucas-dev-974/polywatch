import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import type { DataSource } from 'typeorm';
import { MoveEventService } from './move-event.service.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import { TraderSnapshot } from '../entities/TraderSnapshot.js';
import { TraderSnapshotSeq } from '../entities/TraderSnapshotSeq.js';

describe('MoveEventService.backfillRecentAvgPrice', () => {
  let ds: DataSource;
  let service: MoveEventService;

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    service = new MoveEventService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('returns 0 when no OPENED events need backfill', async () => {
    const traderAddress = '0xtrader1';

    // Create an OPENED event that already has avgPrice
    await ds.getRepository(MoveEventEntity).save({
      id: 'move-1',
      traderAddress,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      eventType: 'OPENED',
      previousTraderSize: 0,
      traderSize: 100,
      traderAvgPrice: 0.5,
      snapshotSeq: 1,
      processed: true,
      detectedAt: new Date(),
    });

    const snapshots = [
      { conditionId: 'cond-1', assetId: 'asset-1', avgPrice: 0.45 },
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(0);
  });

  it('backfills avgPrice for recent OPENED events with null avgPrice', async () => {
    const traderAddress = '0xtrader1';

    // Create an OPENED event without avgPrice
    await ds.getRepository(MoveEventEntity).save({
      id: 'move-2',
      traderAddress,
      conditionId: 'cond-1',
      assetId: 'asset-1',
      eventType: 'OPENED',
      previousTraderSize: 0,
      traderSize: 100,
      traderAvgPrice: null, // Missing avgPrice
      snapshotSeq: 1,
      processed: false,
      detectedAt: new Date(),
    });

    const snapshots = [
      { conditionId: 'cond-1', assetId: 'asset-1', avgPrice: 0.52 },
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(1);

    // Verify the event was updated
    const updated = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-2' },
    });
    expect(updated?.traderAvgPrice).toBe(0.52);
  });

  it('backfills avgPrice for recent OPENED events with avgPrice = 0', async () => {
    const traderAddress = '0xtrader2';

    // Create an OPENED event with avgPrice = 0 (unknown)
    await ds.getRepository(MoveEventEntity).save({
      id: 'move-3',
      traderAddress,
      conditionId: 'cond-2',
      assetId: 'asset-2',
      eventType: 'OPENED',
      previousTraderSize: 0,
      traderSize: 200,
      traderAvgPrice: 0, // Zero means unknown
      snapshotSeq: 1,
      processed: false,
      detectedAt: new Date(),
    });

    const snapshots = [
      { conditionId: 'cond-2', assetId: 'asset-2', avgPrice: 0.35 },
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(1);

    const updated = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-3' },
    });
    expect(updated?.traderAvgPrice).toBe(0.35);
  });

  it('does not backfill events older than maxAgeMs', async () => {
    const traderAddress = '0xtrader3';

    // Create an old OPENED event
    const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    await ds.getRepository(MoveEventEntity).save({
      id: 'move-old',
      traderAddress,
      conditionId: 'cond-3',
      assetId: 'asset-3',
      eventType: 'OPENED',
      previousTraderSize: 0,
      traderSize: 300,
      traderAvgPrice: null,
      snapshotSeq: 1,
      processed: false,
      detectedAt: oldDate,
    });

    const snapshots = [
      { conditionId: 'cond-3', assetId: 'asset-3', avgPrice: 0.72 },
    ];

    // Default maxAgeMs is 5 minutes, so this event should not be backfilled
    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(0);

    const unchanged = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-old' },
    });
    expect(unchanged?.traderAvgPrice).toBeNull();
  });

  it('does not backfill non-OPENED events', async () => {
    const traderAddress = '0xtrader4';

    // Create an INCREASED event without avgPrice
    await ds.getRepository(MoveEventEntity).save({
      id: 'move-4',
      traderAddress,
      conditionId: 'cond-4',
      assetId: 'asset-4',
      eventType: 'INCREASED',
      previousTraderSize: 100,
      traderSize: 200,
      traderAvgPrice: null,
      snapshotSeq: 1,
      processed: false,
      detectedAt: new Date(),
    });

    const snapshots = [
      { conditionId: 'cond-4', assetId: 'asset-4', avgPrice: 0.61 },
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(0);
  });

  it('backfills multiple events for the same trader', async () => {
    const traderAddress = '0xtrader5';

    // Create multiple OPENED events without avgPrice
    await ds.getRepository(MoveEventEntity).save([
      {
        id: 'move-5a',
        traderAddress,
        conditionId: 'cond-5',
        assetId: 'asset-5a',
        eventType: 'OPENED',
        previousTraderSize: 0,
        traderSize: 100,
        traderAvgPrice: null,
        snapshotSeq: 1,
        processed: false,
        detectedAt: new Date(),
      },
      {
        id: 'move-5b',
        traderAddress,
        conditionId: 'cond-5',
        assetId: 'asset-5b',
        eventType: 'OPENED',
        previousTraderSize: 0,
        traderSize: 150,
        traderAvgPrice: 0,
        snapshotSeq: 1,
        processed: false,
        detectedAt: new Date(),
      },
    ]);

    const snapshots = [
      { conditionId: 'cond-5', assetId: 'asset-5a', avgPrice: 0.42 },
      { conditionId: 'cond-5', assetId: 'asset-5b', avgPrice: 0.58 },
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(2);

    const updated1 = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-5a' },
    });
    const updated2 = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-5b' },
    });
    expect(updated1?.traderAvgPrice).toBe(0.42);
    expect(updated2?.traderAvgPrice).toBe(0.58);
  });

  it('ignores snapshots with avgPrice = 0 or undefined', async () => {
    const traderAddress = '0xtrader6';

    await ds.getRepository(MoveEventEntity).save({
      id: 'move-6',
      traderAddress,
      conditionId: 'cond-6',
      assetId: 'asset-6',
      eventType: 'OPENED',
      previousTraderSize: 0,
      traderSize: 100,
      traderAvgPrice: null,
      snapshotSeq: 1,
      processed: false,
      detectedAt: new Date(),
    });

    // Snapshot has no valid avgPrice
    const snapshots = [
      { conditionId: 'cond-6', assetId: 'asset-6', avgPrice: 0 }, // Invalid
      { conditionId: 'cond-6', assetId: 'asset-6', avgPrice: undefined }, // Invalid
    ];

    const result = await service.backfillRecentAvgPrice(traderAddress, snapshots);
    expect(result).toBe(0);
  });

  it('only backfills events for the specified trader', async () => {
    const trader1 = '0xtrader1';
    const trader2 = '0xtrader2';

    await ds.getRepository(MoveEventEntity).save([
      {
        id: 'move-t1',
        traderAddress: trader1,
        conditionId: 'cond-shared',
        assetId: 'asset-shared',
        eventType: 'OPENED',
        previousTraderSize: 0,
        traderSize: 100,
        traderAvgPrice: null,
        snapshotSeq: 1,
        processed: false,
        detectedAt: new Date(),
      },
      {
        id: 'move-t2',
        traderAddress: trader2,
        conditionId: 'cond-shared',
        assetId: 'asset-shared',
        eventType: 'OPENED',
        previousTraderSize: 0,
        traderSize: 200,
        traderAvgPrice: null,
        snapshotSeq: 1,
        processed: false,
        detectedAt: new Date(),
      },
    ]);

    const snapshots = [
      { conditionId: 'cond-shared', assetId: 'asset-shared', avgPrice: 0.55 },
    ];

    // Only backfill for trader1
    const result = await service.backfillRecentAvgPrice(trader1, snapshots);
    expect(result).toBe(1);

    const t1Event = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-t1' },
    });
    const t2Event = await ds.getRepository(MoveEventEntity).findOne({
      where: { id: 'move-t2' },
    });

    expect(t1Event?.traderAvgPrice).toBe(0.55);
    expect(t2Event?.traderAvgPrice).toBeNull();
  });
});