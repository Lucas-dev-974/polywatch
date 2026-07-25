import { describe, expect, it } from 'vitest';
import { resolveWinningOutcome } from './redemption.js';

describe('resolveWinningOutcome', () => {
  const yes = '0xabc123';
  const no = '0xdef456';

  it('returns YES when winning token matches tokenIdYes', () => {
    expect(resolveWinningOutcome('abc123', yes, no)).toBe('YES');
    expect(resolveWinningOutcome('0xABC123', yes, no)).toBe('YES');
  });

  it('returns NO when winning token matches tokenIdNo', () => {
    expect(resolveWinningOutcome('def456', yes, no)).toBe('NO');
  });

  it('returns null when winning token is unknown', () => {
    expect(resolveWinningOutcome('unknown', yes, no)).toBeNull();
    expect(resolveWinningOutcome('unknown', null, null)).toBeNull();
  });
});
