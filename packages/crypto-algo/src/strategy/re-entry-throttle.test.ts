import { describe, expect, it } from 'vitest';
import {
  buildReEntryKey,
  cleanupReentryMap,
  normalizeReEntryOutcome,
  recordReEntrySuccess,
  shouldSuppressReEntry,
  type ReEntryState,
} from './re-entry-throttle.js';

describe('re-entry throttle', () => {
  it('builds composite key per outcome', () => {
    expect(buildReEntryKey('0xabc', 'YES')).toBe('0xabc:YES');
    expect(buildReEntryKey('0xabc', 'NO')).toBe('0xabc:NO');
  });

  it('does not suppress when no prior confirmed fill', () => {
    expect(shouldSuppressReEntry(undefined, 1000, 1)).toBe(false);
  });

  it('suppresses second fill in same window for same outcome', () => {
    const state: ReEntryState = {
      windowStart: 1000,
      windowMs: 60_000,
      count: 1,
    };
    expect(shouldSuppressReEntry(state, 2000, 1)).toBe(true);
    expect(shouldSuppressReEntry(state, 70_000, 1)).toBe(false);
  });

  it('allows opposite outcome after first outcome consumed slot', () => {
    const map = new Map<string, ReEntryState>();
    recordReEntrySuccess(map, buildReEntryKey('0xabc', 'YES'), 1000, 60_000);

    const yesState = map.get(buildReEntryKey('0xabc', 'YES'));
    const noState = map.get(buildReEntryKey('0xabc', 'NO'));

    expect(shouldSuppressReEntry(yesState, 2000, 1)).toBe(true);
    expect(shouldSuppressReEntry(noState, 2000, 1)).toBe(false);
  });

  it('does not increment when pipeline skip — record only on fill', () => {
    const map = new Map<string, ReEntryState>();
    expect(shouldSuppressReEntry(map.get('0xabc:YES'), 2000, 1)).toBe(false);
  });

  it('normalizes outcome labels for re-entry keys', () => {
    expect(normalizeReEntryOutcome('NO')).toBe('NO');
    expect(normalizeReEntryOutcome('Down')).toBe('NO');
    expect(normalizeReEntryOutcome('yes')).toBe('YES');
    expect(normalizeReEntryOutcome('Up')).toBe('YES');
    expect(normalizeReEntryOutcome('maybe')).toBe(null);
  });

  it('cleans up using stored windowMs not global ctor default', () => {
    const map = new Map<string, ReEntryState>([
      [
        '0xabc:YES',
        { windowStart: 0, windowMs: 5_000, count: 1 },
      ],
    ]);
    expect(cleanupReentryMap(map, 6_000)).toBe(1);
    expect(map.size).toBe(0);

    map.set('0xabc:NO', { windowStart: 0, windowMs: 60_000, count: 1 });
    expect(cleanupReentryMap(map, 10_000)).toBe(0);
    expect(map.size).toBe(1);
  });
});
