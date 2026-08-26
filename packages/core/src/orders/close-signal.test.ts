import { describe, expect, it } from 'vitest';
import {
  buildCloseOrderSignal,
  buildSlCloseRetrySignal,
  isTotalCloseSignal,
} from './close-signal.js';

const basePos = {
  id: 7,
  mode: 'sim',
  conditionId: 'cond-1',
  assetId: 'asset-1',
  quantity: 50,
  entryPrice: 0.42,
  executableBidVwap: 0.55,
  closingAttemptSeq: 2,
};

describe('close-signal', () => {
  it('detects total close signals', () => {
    expect(
      isTotalCloseSignal({ side: 'SELL', reason: 'MANUAL' }),
    ).toBe(true);
    expect(
      isTotalCloseSignal({ side: 'SELL', reason: 'WEATHER_BUCKET_EXIT' }),
    ).toBe(true);
    expect(
      isTotalCloseSignal({ side: 'SELL', reason: 'WEATHER_FORECAST_CHANGE' }),
    ).toBe(true);
    expect(
      isTotalCloseSignal({ side: 'SELL', reason: 'COPY_DECREASE' }),
    ).toBe(false);
    expect(
      isTotalCloseSignal({ side: 'BUY', reason: 'MANUAL' }),
    ).toBe(false);
  });

  it('builds strategy close without pre-close seq', () => {
    const signal = buildCloseOrderSignal({
      pos: basePos,
      reason: 'TP',
      bidVwap: 0.55,
    });

    expect(signal.side).toBe('SELL');
    expect(signal.orderType).toBe('FAK');
    expect(signal.quantity).toBe(50);
    expect(signal.referenceVwap).toBe(0.55);
    expect(signal.closingAttemptSeq).toBe(3);
    expect(signal.lastTradePrice).toBeUndefined();
    expect(signal.id).toHaveLength(64);
  });

  it('carries lastTradePrice into the close signal', () => {
    const signal = buildCloseOrderSignal({
      pos: basePos,
      reason: 'SL',
      bidVwap: 0.55,
      lastTradePrice: 0.48,
    });

    expect(signal.lastTradePrice).toBe(0.48);
  });

  it('builds manual close with resume seq', () => {
    const signal = buildCloseOrderSignal({
      pos: basePos,
      reason: 'MANUAL',
      bidVwap: 0.55,
      closingAttemptSeq: 3,
    });

    expect(signal.reason).toBe('MANUAL');
    expect(signal.closingAttemptSeq).toBe(3);
  });

  it('buildSlCloseRetrySignal carries lastTradePrice', async () => {
    const signal = await buildSlCloseRetrySignal({
      pos: basePos,
      previousAttempt: 1,
      reason: 'SL',
      lastTradePrice: 0.41,
      fetchBid: async () => ({ executableBidVwap: 0.4 }),
    });

    expect(signal?.reason).toBe('SL');
    expect(signal?.lastTradePrice).toBe(0.41);
    expect(signal?.closeRetryAttempt).toBe(2);
  });
});
