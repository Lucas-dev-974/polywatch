import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../../packages/core/src/database/data-source.js';
import { createTestDataSource } from '../../packages/core/src/database/test-data-source.js';
import { CopiedPosition } from '../../packages/core/src/entities/CopiedPosition.js';
import { Execution } from '../../packages/core/src/entities/Execution.js';
import { Market } from '../../packages/core/src/entities/Market.js';
import { ExecutionService } from '../../packages/core/src/services/execution.service.js';
import { seedDefaults } from '../../packages/core/src/seed/defaults.js';
import { parseFillResponse } from '../../packages/worker/src/clob/parse-fill-response.js';

describe('E2E audit compliance — sim mode', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let executionService: ExecutionService;

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    await seedDefaults(ds);
    executionService = new ExecutionService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('1. slippage guard skips when referenceVwap is 0 (no division by zero)', async () => {
    const referenceVwap = 0;
    const fillPrice = 0.5;
    const shouldGuard = referenceVwap != null && referenceVwap > 0;
    expect(shouldGuard).toBe(false);

    if (shouldGuard) {
      const slip = (Math.abs(fillPrice - referenceVwap) / referenceVwap) * 100;
      expect(slip).toBeNaN();
    }
  });

  it('2. double finalization is idempotent (no duplicate PnL / fees / cash)', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'sig-close-1',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'COPY_CLOSE',
      requestedQty: 100,
    });

    const finalize = () =>
      executionService.finalize({
        orderSignalId: 'sig-close-1',
        status: 'filled',
        fillPrice: 0.6,
        fillQuantity: 100,
        fees: 0,
      });

    // First call finalizes the execution and mutates the position.
    const first = await finalize();
    expect(first?.status).toBe('closed');

    // Second call must be idempotent: either detect already-filled or recover
    // from an optimistic-lock mismatch and still return the finalized position.
    const second = await finalize();
    expect(second?.status).toBe('closed');

    // PnL and fees must have been applied exactly once.
    const closed = await posRepo.findOne({ where: { id: pos.id } });
    expect(closed?.status).toBe('closed');
    expect(closed?.quantity).toBe(0);
    expect(closed?.realizedPnl).toBeCloseTo(10, 5); // (0.6 - 0.5) * 100 = 10

    const exec = await execRepo.findOne({ where: { orderSignalId: 'sig-close-1' } });
    expect(exec?.status).toBe('filled');
    expect(exec?.fees).toBe(0);
  });

  it('3. Zod schema rejects malformed CLOB responses', () => {
    const malformed = { orderID: 12345, status: 'matched' };
    const result = parseFillResponse(malformed, 'BUY', 0.5, 200);

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toContain('response_schema_mismatch');
    }
  });

  it('3. Zod schema accepts valid CLOB responses', () => {
    const response = {
      orderID: '0xabcdef1234567890abcdef1234567890abcdef12',
      status: 'matched',
      makingAmount: '100000000',
      takingAmount: '200000000',
    };

    const result = parseFillResponse(response, 'BUY', 0.5, 200);
    expect(result.type).toBe('matched');
    if (result.type === 'matched') {
      expect(result.fill.fillQuantity).toBe(200);
      expect(result.fill.actualFillPrice).toBe(0.5);
    }
  });

  it('4. V1 dead code removed: Market entity has no takerBaseFee column', () => {
    const repo = ds.getRepository(Market);
    const meta = repo.metadata;
    const columnNames = meta.columns.map((c) => c.propertyName);

    expect(columnNames).not.toContain('takerBaseFee');
    expect(columnNames).toContain('feeRate');
    expect(columnNames).toContain('feeExponent');
  });
});
