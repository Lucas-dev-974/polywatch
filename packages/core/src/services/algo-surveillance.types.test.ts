import { describe, expect, it } from 'vitest';
import {
  isSurveillanceAwaitingClose,
  isSurveillanceLive,
  SURVEILLANCE_CLOSE_TTL_MS,
} from './algo-surveillance.types.js';

const base = {
  openCapturedAt: '2026-06-27T08:05:05.000Z',
  closeCapturedAt: null as string | null,
  unresolvedAt: null as string | null,
  marketEndAt: '2026-06-27T08:10:00.000Z',
};

describe('isSurveillanceLive', () => {
  it('returns true while the market window is open', () => {
    expect(isSurveillanceLive(base, Date.parse('2026-06-27T08:07:00.000Z'))).toBe(true);
  });

  it('returns false after marketEndAt', () => {
    expect(isSurveillanceLive(base, Date.parse('2026-06-27T08:10:00.000Z'))).toBe(false);
  });

  it('returns false once close is captured', () => {
    expect(
      isSurveillanceLive(
        { ...base, closeCapturedAt: '2026-06-27T08:10:02.000Z' },
        Date.parse('2026-06-27T08:07:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('isSurveillanceAwaitingClose', () => {
  it('returns false while the market window is open', () => {
    expect(isSurveillanceAwaitingClose(base, Date.parse('2026-06-27T08:07:00.000Z'))).toBe(
      false,
    );
  });

  it('returns true after marketEndAt until close TTL expires', () => {
    const endMs = Date.parse(base.marketEndAt);
    expect(isSurveillanceAwaitingClose(base, endMs)).toBe(true);
    expect(isSurveillanceAwaitingClose(base, endMs + SURVEILLANCE_CLOSE_TTL_MS - 1)).toBe(
      true,
    );
    expect(isSurveillanceAwaitingClose(base, endMs + SURVEILLANCE_CLOSE_TTL_MS)).toBe(false);
  });
});
