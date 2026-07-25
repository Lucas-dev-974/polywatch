import { describe, expect, it } from 'vitest';
import { formatEasternTime } from './useEasternTime';

describe('formatEasternTime', () => {
  it('returns a string in HH:MM format', () => {
    const result = formatEasternTime(Date.now());
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns different values for different timestamps', () => {
    const t1 = formatEasternTime(new Date('2025-06-25T12:00:00Z').getTime());
    const t2 = formatEasternTime(new Date('2025-06-25T13:00:00Z').getTime());
    expect(t1).not.toBe(t2);
  });

  it('handles EST (UTC-5) correctly', () => {
    // 2025-01-01 05:00 UTC = 00:00 ET (EST, UTC-5)
    const result = formatEasternTime(new Date('2025-01-01T05:00:00Z').getTime());
    expect(result).toBe('00:00');
  });

  it('handles EDT (UTC-4) correctly', () => {
    // 2025-06-25 12:00 UTC = 08:00 ET (EDT, UTC-4)
    const result = formatEasternTime(new Date('2025-06-25T12:00:00Z').getTime());
    expect(result).toBe('08:00');
  });
});
