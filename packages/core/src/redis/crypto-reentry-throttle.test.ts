import { describe, expect, it, vi } from 'vitest';
import {
  cryptoReentryThrottleKey,
  isCryptoReentrySuppressed,
  parseCryptoReentryRedisState,
  recordCryptoReentryFill,
  tryLoadCryptoReentryState,
} from './crypto-reentry-throttle.js';

describe('crypto-reentry-throttle', () => {
  it('builds a stable key', () => {
    expect(cryptoReentryThrottleKey('0xabc', 'YES')).toBe('crypto-reentry:0xabc:YES');
  });

  it('parses valid state and rejects garbage', () => {
    expect(
      parseCryptoReentryRedisState(
        JSON.stringify({ windowStart: 1, windowMs: 1000, count: 1, positionIds: [9] }),
      ),
    ).toEqual({ windowStart: 1, windowMs: 1000, count: 1, positionIds: [9] });
    expect(parseCryptoReentryRedisState('not-json')).toBeNull();
    expect(parseCryptoReentryRedisState('{"count":1}')).toBeNull();
  });

  it('suppresses only inside an active full window', () => {
    const state = { windowStart: 1000, windowMs: 60_000, count: 1, positionIds: [1] };
    expect(isCryptoReentrySuppressed(state, 2000, 1)).toBe(true);
    expect(isCryptoReentrySuppressed(state, 70_000, 1)).toBe(false);
    expect(isCryptoReentrySuppressed(null, 2000, 1)).toBe(false);
  });

  it('records first fill and is idempotent for the same positionId', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    };

    const first = await recordCryptoReentryFill(redis, {
      conditionId: '0xabc',
      outcome: 'YES',
      positionId: 10,
      windowMs: 60_000,
      nowMs: 1000,
    });
    expect(first.recorded).toBe(true);
    expect(first.state.count).toBe(1);

    const again = await recordCryptoReentryFill(redis, {
      conditionId: '0xabc',
      outcome: 'YES',
      positionId: 10,
      windowMs: 60_000,
      nowMs: 1500,
    });
    expect(again.recorded).toBe(false);
    expect(again.state.count).toBe(1);

    const secondPos = await recordCryptoReentryFill(redis, {
      conditionId: '0xabc',
      outcome: 'YES',
      positionId: 11,
      windowMs: 60_000,
      nowMs: 2000,
    });
    expect(secondPos.recorded).toBe(true);
    expect(secondPos.state.count).toBe(2);
  });

  it('surfaces Redis failures via tryLoad', async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const result = await tryLoadCryptoReentryState(redis, '0xabc', 'YES');
    expect(result.ok).toBe(false);
  });
});
