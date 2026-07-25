import { describe, expect, it } from 'vitest';
import { elapsedMsSince } from './session-elapsed';

describe('elapsedMsSince', () => {
  it('computes duration for active session from now', () => {
    const start = '2026-07-11T10:00:00.000Z';
    const now = new Date('2026-07-11T10:30:00.000Z').getTime();
    expect(elapsedMsSince(start, null, now)).toBe(30 * 60_000);
  });

  it('uses endedAt for closed sessions', () => {
    const start = '2026-07-11T10:00:00.000Z';
    const end = '2026-07-11T12:00:00.000Z';
    const now = new Date('2026-07-11T15:00:00.000Z').getTime();
    expect(elapsedMsSince(start, end, now)).toBe(2 * 60 * 60_000);
  });
});
