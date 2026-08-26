import { describe, expect, it } from 'vitest';
import {
  evaluatePreCloseExit,
  evaluatePositionExit,
} from './exit-decision.js';

describe('evaluatePreCloseExit', () => {
  const inWindow = {
    preCloseEnabled: true,
    preCloseSeconds: 60,
    timeToEndMs: 30_000,
    marketSettled: false,
    markBid: 0,
    keepEnabled: false,
    keepBidThreshold: 0.80,
  };

  it('keeps position when keep is enabled and bid meets threshold', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: true,
        keepBidThreshold: 0.80,
        markBid: 0.85,
        effectiveTrigger: -5,
        effectiveClosure: -8,
      }),
    ).toBeNull();
  });

  it('sells losing position when keep is enabled but bid is below threshold', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: true,
        keepBidThreshold: 0.80,
        markBid: 0.75,
        effectiveTrigger: -5,
        effectiveClosure: -8,
      }),
    ).toBe('PRE_CLOSE_LOSS');
  });

  it('sells winning position when keep is enabled but bid is below threshold', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: true,
        keepBidThreshold: 0.80,
        markBid: 0.75,
        effectiveTrigger: 10,
        effectiveClosure: 8,
      }),
    ).toBe('PRE_CLOSE_WIN');
  });

  it('sells losing position when keep is disabled', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: false,
        effectiveTrigger: -3,
        effectiveClosure: 2,
      }),
    ).toBe('PRE_CLOSE_LOSS');
  });

  it('sells winning position when keep is disabled', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: false,
        effectiveTrigger: 10,
        effectiveClosure: 8,
      }),
    ).toBe('PRE_CLOSE_WIN');
  });

  it('returns null outside the pre-close window', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        timeToEndMs: 120_000,
        keepEnabled: false,
        effectiveTrigger: -10,
        effectiveClosure: -10,
      }),
    ).toBeNull();
  });

  it('returns null when market is settled', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        marketSettled: true,
        effectiveTrigger: -10,
        effectiveClosure: -10,
      }),
    ).toBeNull();
  });

  it('returns null when pre-close is disabled', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        preCloseEnabled: false,
        effectiveTrigger: -10,
        effectiveClosure: -10,
      }),
    ).toBeNull();
  });

  it('keeps position when markBid is 0 (no bid data) even if keep is enabled', () => {
    expect(
      evaluatePreCloseExit({
        ...inWindow,
        keepEnabled: true,
        keepBidThreshold: 0.80,
        markBid: 0,
        effectiveTrigger: -5,
        effectiveClosure: -8,
      }),
    ).toBe('PRE_CLOSE_LOSS');
  });
});

describe('evaluatePositionExit', () => {
  const basePreClose = {
    preCloseEnabled: true,
    preCloseSeconds: 60,
    keepEnabled: false,
    keepBidThreshold: 0.80,
    markBid: 0,
    timeToEndMs: 30_000,
    marketSettled: false,
    effectiveTrigger: -5,
    effectiveClosure: -5,
  };

  it('prefers SL over pre-close on the same tick', () => {
    expect(
      evaluatePositionExit({
        slTpInput: {
          slPercent: 20,
          tpPercent: null,
          trailingPercent: null,
          trailingActivationPercent: null,
          effectiveTrigger: -25,
          effectiveClosure: -25,
          peakClosurePnlPercent: -5,
        },
        preCloseInput: {
          ...basePreClose,
          effectiveTrigger: -25,
          effectiveClosure: -25,
        },
      }),
    ).toBe('SL');
  });

  it('falls through to pre-close when SL does not fire', () => {
    expect(
      evaluatePositionExit({
        slTpInput: {
          slPercent: 20,
          tpPercent: null,
          trailingPercent: null,
          trailingActivationPercent: null,
          effectiveTrigger: -5,
          effectiveClosure: -5,
          peakClosurePnlPercent: -5,
        },
        preCloseInput: basePreClose,
      }),
    ).toBe('PRE_CLOSE_LOSS');
  });

  it('skips SL when suppressSlTp is set (post-resolution path)', () => {
    expect(
      evaluatePositionExit({
        slTpInput: {
          slPercent: 20,
          tpPercent: null,
          trailingPercent: null,
          trailingActivationPercent: null,
          effectiveTrigger: -99,
          effectiveClosure: -99,
          peakClosurePnlPercent: -5,
        },
        preCloseInput: {
          ...basePreClose,
          timeToEndMs: -5_000,
          acceptingOrders: true,
          effectiveTrigger: -99,
          effectiveClosure: -99,
        },
        suppressSlTp: true,
      }),
    ).toBe('PRE_CLOSE_LOSS');
  });

  it('returns null for SL when suppressSlTp and pre-close not in scope', () => {
    expect(
      evaluatePositionExit({
        slTpInput: {
          slPercent: 20,
          tpPercent: null,
          trailingPercent: null,
          trailingActivationPercent: null,
          effectiveTrigger: -99,
          effectiveClosure: -99,
          peakClosurePnlPercent: -5,
        },
        preCloseInput: {
          ...basePreClose,
          timeToEndMs: -120_000,
          acceptingOrders: false,
          effectiveTrigger: -99,
          effectiveClosure: -99,
        },
        suppressSlTp: true,
      }),
    ).toBeNull();
  });
});
