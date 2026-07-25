import { describe, expect, it } from 'vitest';
import { normalizeExitAttemptMarkBid } from './exit-attempt-mark.js';

describe('normalizeExitAttemptMarkBid', () => {
  it('accepts positive finite values', () => {
    expect(normalizeExitAttemptMarkBid(0.42)).toBe(0.42);
  });

  it('rejects null, non-finite, and non-positive', () => {
    expect(normalizeExitAttemptMarkBid(null)).toBeNull();
    expect(normalizeExitAttemptMarkBid(undefined)).toBeNull();
    expect(normalizeExitAttemptMarkBid(0)).toBeNull();
    expect(normalizeExitAttemptMarkBid(-0.1)).toBeNull();
    expect(normalizeExitAttemptMarkBid(Number.NaN)).toBeNull();
  });
});
