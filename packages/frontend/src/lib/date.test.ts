import { describe, expect, it } from 'vitest';
import { formatTimeAgo, formatTimeAgoPhrase, resolveExecutionEventIso, isExecutionFillTimestamp } from './date';

const NOW = Date.parse('2026-08-30T10:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

describe('formatTimeAgo', () => {
  it('returns an em dash when the timestamp is missing', () => {
    expect(formatTimeAgo(null, NOW)).toBe('—');
    expect(formatTimeAgo(undefined, NOW)).toBe('—');
  });

  it('treats future timestamps as just now', () => {
    expect(formatTimeAgo(iso(-1_000), NOW)).toBe('à l’instant');
  });

  it('uses un instant under 5 seconds', () => {
    expect(formatTimeAgo(iso(0), NOW)).toBe('un instant');
    expect(formatTimeAgo(iso(4_999), NOW)).toBe('un instant');
  });

  it('uses compact seconds under a minute', () => {
    expect(formatTimeAgo(iso(5_000), NOW)).toBe('5s');
    expect(formatTimeAgo(iso(12_000), NOW)).toBe('12s');
    expect(formatTimeAgo(iso(59_999), NOW)).toBe('59s');
  });

  it('uses compact minutes, hours and days', () => {
    expect(formatTimeAgo(iso(60_000), NOW)).toBe('1min');
    expect(formatTimeAgo(iso(5 * 60_000), NOW)).toBe('5min');
    expect(formatTimeAgo(iso(60 * 60_000), NOW)).toBe('1h');
    expect(formatTimeAgo(iso(3 * 60 * 60_000), NOW)).toBe('3h');
    expect(formatTimeAgo(iso(24 * 60 * 60_000), NOW)).toBe('1j');
    expect(formatTimeAgo(iso(2 * 24 * 60 * 60_000), NOW)).toBe('2j');
  });
});

describe('formatTimeAgoPhrase', () => {
  it('prefixes il y a for compact units', () => {
    expect(formatTimeAgoPhrase(iso(12_000), NOW)).toBe('il y a 12s');
    expect(formatTimeAgoPhrase(iso(2 * 60_000), NOW)).toBe('il y a 2min');
    expect(formatTimeAgoPhrase(iso(3 * 60 * 60_000), NOW)).toBe('il y a 3h');
    expect(formatTimeAgoPhrase(iso(2 * 24 * 60 * 60_000), NOW)).toBe('il y a 2j');
  });

  it('does not prefix il y a for instant / missing', () => {
    expect(formatTimeAgoPhrase(null, NOW)).toBe('—');
    expect(formatTimeAgoPhrase(iso(0), NOW)).toBe('à l’instant');
    expect(formatTimeAgoPhrase(iso(-500), NOW)).toBe('à l’instant');
  });
});

describe('resolveExecutionEventIso', () => {
  const filled = '2026-08-30T09:00:00.000Z';
  const created = '2026-08-30T08:59:50.000Z';
  const updated = '2026-08-30T09:01:00.000Z';

  it('prefers executedAt when present', () => {
    expect(resolveExecutionEventIso({
      executedAt: filled,
      createdAt: created,
      updatedAt: updated,
    })).toBe(filled);
    expect(isExecutionFillTimestamp({ executedAt: filled, createdAt: created })).toBe(true);
  });

  it('falls back to createdAt when executedAt is null (failed / unfilled)', () => {
    expect(resolveExecutionEventIso({
      executedAt: null,
      createdAt: created,
    })).toBe(created);
    expect(isExecutionFillTimestamp({ executedAt: null, createdAt: created })).toBe(false);
  });

  it('falls back to updatedAt when executedAt and createdAt are missing', () => {
    expect(resolveExecutionEventIso({
      executedAt: null,
      createdAt: null,
      updatedAt: updated,
    })).toBe(updated);
  });

  it('returns null when no timestamp is present', () => {
    expect(resolveExecutionEventIso({ executedAt: null })).toBeNull();
    expect(resolveExecutionEventIso({})).toBeNull();
  });
});
