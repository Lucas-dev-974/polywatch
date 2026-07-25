import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_ENTRY_MOS_FLOOR,
  effectiveEntryMos,
  ensureEntryQuantityMeetsMos,
} from './entry-mos.js';

describe('effectiveEntryMos', () => {
  it('uses market MOS when source is clob or book', () => {
    expect(effectiveEntryMos({ minShares: 10, source: 'clob' })).toBe(10);
    expect(effectiveEntryMos({ minShares: 7, source: 'book' })).toBe(7);
  });

  it('applies conservative floor when lookup fell back', () => {
    expect(effectiveEntryMos({ minShares: 1, source: 'fallback' })).toBe(
      CONSERVATIVE_ENTRY_MOS_FLOOR,
    );
  });
});

describe('ensureEntryQuantityMeetsMos', () => {
  const base = {
    effectiveMos: 5,
    askVwap: 0.6,
    cash: 100,
    maxPositionSizeUsdc: 50,
  };

  it('passes through when targetQty already meets MOS', () => {
    const result = ensureEntryQuantityMeetsMos({ ...base, targetQty: 6 });
    expect(result).toEqual({
      ok: true,
      quantity: 6,
      bumped: false,
      effectiveMos: 5,
    });
  });

  it('bumps to MOS when cash and cap allow', () => {
    const result = ensureEntryQuantityMeetsMos({ ...base, targetQty: 3.33 });
    expect(result).toEqual({
      ok: true,
      quantity: 5,
      bumped: true,
      effectiveMos: 5,
    });
  });

  it('skips when bump notional exceeds cash', () => {
    const result = ensureEntryQuantityMeetsMos({
      ...base,
      targetQty: 3,
      cash: 2,
    });
    expect(result).toEqual({ ok: false, reason: 'below_mos_cannot_bump' });
  });

  it('skips when bump notional exceeds max position size', () => {
    const result = ensureEntryQuantityMeetsMos({
      ...base,
      targetQty: 3,
      maxPositionSizeUsdc: 2,
    });
    expect(result).toEqual({ ok: false, reason: 'below_mos_cannot_bump' });
  });
});
