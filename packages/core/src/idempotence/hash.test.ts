import { describe, expect, it } from 'vitest';
import {
  hashAlgoLogicalKey,
  hashAlgoOrderSignalId,
  hashCopyOrderSignalId,
  hashMoveEventId,
  hashRedemptionOrderSignalId,
  hashStrategyOrderSignalId,
} from './hash.js';

describe('idempotence hashes', () => {
  it('produces deterministic MoveEvent id', () => {
    const a = hashMoveEventId({
      traderAddress: '0xabc',
      conditionId: 'cond1',
      assetId: 'asset1',
      type: 'OPENED',
      previousTraderSize: 0,
      traderSize: 100,
      snapshotSeq: 1,
    });
    const b = hashMoveEventId({
      traderAddress: '0xabc',
      conditionId: 'cond1',
      assetId: 'asset1',
      type: 'OPENED',
      previousTraderSize: 0,
      traderSize: 100,
      snapshotSeq: 1,
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('produces copy order signal id', () => {
    const id = hashCopyOrderSignalId({
      moveEventId: 'move123',
      mode: 'sim',
      reason: 'COPY_OPEN',
      side: 'BUY',
    });
    expect(id).toHaveLength(64);
  });

  it('produces strategy order signal id with closing seq', () => {
    const id = hashStrategyOrderSignalId({
      copiedPositionId: 42,
      mode: 'sim',
      reason: 'TP',
      closingAttemptSeq: 1,
    });
    expect(id).toHaveLength(64);
  });

  it('includes retry suffix when closeRetryAttempt > 0', () => {
    const base = hashStrategyOrderSignalId({
      copiedPositionId: 42,
      mode: 'sim',
      reason: 'SL',
      closingAttemptSeq: 2,
    });
    const retry = hashStrategyOrderSignalId({
      copiedPositionId: 42,
      mode: 'sim',
      reason: 'SL',
      closingAttemptSeq: 2,
      closeRetryAttempt: 1,
    });
    expect(retry).not.toBe(base);
    expect(retry).toHaveLength(64);
  });

  it('produces redemption id', () => {
    expect(hashRedemptionOrderSignalId(5)).toHaveLength(64);
  });

  it('separates algo order signal ids by mode', () => {
    const base = {
      conditionId: 'cond1',
      interval: '5m',
      outcome: 'YES',
      strategyId: 'naive-momentum',
      copiedPositionId: 42,
    };
    const sim = hashAlgoOrderSignalId({ ...base, mode: 'sim' });
    const real = hashAlgoOrderSignalId({ ...base, mode: 'real' });
    expect(sim).not.toBe(real);
    expect(sim).toHaveLength(64);
  });

  it('separates algo order signal ids by position for re-entries', () => {
    const base = {
      conditionId: 'cond1',
      interval: '5m',
      outcome: 'NO',
      strategyId: 'naive-momentum',
      mode: 'sim' as const,
    };
    const logical = hashAlgoLogicalKey(base);
    const first = hashAlgoOrderSignalId({ ...base, copiedPositionId: 21680 });
    const second = hashAlgoOrderSignalId({ ...base, copiedPositionId: 21682 });
    expect(first).not.toBe(second);
    expect(first).not.toBe(logical);
    expect(logical).toHaveLength(64);
  });
});
