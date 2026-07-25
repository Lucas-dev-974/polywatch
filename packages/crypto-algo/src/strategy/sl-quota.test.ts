import { describe, expect, it } from 'vitest';
import {
  buildSlQuotaCacheKey,
  cleanupSlQuotaCache,
  invalidateSlQuotaCache,
  shouldBlockSlQuotaEntry,
  type SlQuotaState,
} from './sl-quota.js';

describe('sl quota', () => {
  it('shouldBlockSlQuotaEntry blocks when a position is open on market', () => {
    expect(shouldBlockSlQuotaEntry(0, 1, 1)).toEqual({
      blocked: true,
      detail: 'open_position_on_market',
    });
    expect(shouldBlockSlQuotaEntry(0, 2, 3)).toEqual({
      blocked: true,
      detail: 'open_position_on_market',
    });
  });

  it('shouldBlockSlQuotaEntry blocks when SL slots are consumed', () => {
    expect(shouldBlockSlQuotaEntry(1, 0, 1)).toEqual({
      blocked: true,
      detail: 'sl_slots_consumed',
    });
    expect(shouldBlockSlQuotaEntry(2, 0, 2)).toEqual({
      blocked: true,
      detail: 'sl_slots_consumed',
    });
  });

  it('shouldBlockSlQuotaEntry allows entry when no open position and under quota', () => {
    expect(shouldBlockSlQuotaEntry(0, 0, 1)).toEqual({ blocked: false });
    expect(shouldBlockSlQuotaEntry(1, 0, 2)).toEqual({ blocked: false });
  });

  it('open position check takes priority over consumed slots', () => {
    expect(shouldBlockSlQuotaEntry(2, 1, 1)).toEqual({
      blocked: true,
      detail: 'open_position_on_market',
    });
  });

  it('buildSlQuotaCacheKey scopes cache entries per trading mode', () => {
    expect(buildSlQuotaCacheKey('0xabc', 'sim')).toBe('0xabc:sim');
    expect(buildSlQuotaCacheKey('0xabc', 'real')).toBe('0xabc:real');
  });

  it('invalidateSlQuotaCache removes only the requested mode when provided', () => {
    const map = new Map<string, SlQuotaState>([
      ['0xabc:sim', { consumed: 1, openOnMarket: 0, fetchedAt: 1000 }],
      ['0xabc:real', { consumed: 0, openOnMarket: 1, fetchedAt: 2000 }],
      ['0xdef:sim', { consumed: 0, openOnMarket: 1, fetchedAt: 2000 }],
    ]);
    invalidateSlQuotaCache(map, '0xabc', 'sim');
    expect(map.has('0xabc:sim')).toBe(false);
    expect(map.has('0xabc:real')).toBe(true);
    expect(map.has('0xdef:sim')).toBe(true);
  });

  it('invalidateSlQuotaCache removes both modes when mode is omitted', () => {
    const map = new Map<string, SlQuotaState>([
      ['0xabc:sim', { consumed: 1, openOnMarket: 0, fetchedAt: 1000 }],
      ['0xabc:real', { consumed: 0, openOnMarket: 1, fetchedAt: 2000 }],
      ['0xdef:sim', { consumed: 0, openOnMarket: 1, fetchedAt: 2000 }],
    ]);
    invalidateSlQuotaCache(map, '0xabc');
    expect(map.has('0xabc:sim')).toBe(false);
    expect(map.has('0xabc:real')).toBe(false);
    expect(map.has('0xdef:sim')).toBe(true);
  });

  it('cleanupSlQuotaCache removes stale entries only', () => {
    const map = new Map<string, SlQuotaState>([
      ['old', { consumed: 1, openOnMarket: 0, fetchedAt: 0 }],
      ['fresh', { consumed: 1, openOnMarket: 0, fetchedAt: 9_000 }],
    ]);
    expect(cleanupSlQuotaCache(map, 10_000, 5_000)).toBe(1);
    expect(map.has('old')).toBe(false);
    expect(map.has('fresh')).toBe(true);
  });
});
