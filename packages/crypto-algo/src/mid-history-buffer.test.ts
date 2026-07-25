import { describe, expect, it } from 'vitest';
import { MidHistoryBuffer, CURVE_SAMPLE_INTERVAL_MS } from './mid-history-buffer.js';

describe('MidHistoryBuffer', () => {
  it('decimates samples by CURVE_SAMPLE_INTERVAL_MS', () => {
    const buf = new MidHistoryBuffer();
    const base = 1_000_000;
    buf.record('asset1', 0.65, base);
    buf.record('asset1', 0.64, base + CURVE_SAMPLE_INTERVAL_MS - 1);
    buf.record('asset1', 0.63, base + CURVE_SAMPLE_INTERVAL_MS);
    const window = buf.getWindow('asset1', 60_000, base + CURVE_SAMPLE_INTERVAL_MS);
    expect(window).toHaveLength(2);
    expect(window[0]!.mid).toBe(0.65);
    expect(window[1]!.mid).toBe(0.63);
  });

  it('returns samples within lookback window', () => {
    const buf = new MidHistoryBuffer();
    const now = 50_000;
    buf.record('a', 0.6, now - 12_000);
    buf.record('a', 0.61, now - 8_000);
    buf.record('a', 0.62, now - 4_000);
    const window = buf.getWindow('a', 10_000, now);
    expect(window).toHaveLength(2);
    expect(window[0]!.mid).toBe(0.61);
    expect(window[1]!.mid).toBe(0.62);
  });

  it('prunes samples older than CURVE_BUFFER_MAX_MS', () => {
    const buf = new MidHistoryBuffer();
    const now = 100_000;
    buf.record('a', 0.5, now - 70_000);
    buf.record('a', 0.6, now - 5_000);
    const window = buf.getWindow('a', 60_000, now);
    expect(window).toHaveLength(1);
    expect(window[0]!.mid).toBe(0.6);
  });

  it('clear removes asset history', () => {
    const buf = new MidHistoryBuffer();
    const now = 10_000;
    buf.record('a', 0.5, now);
    buf.clear('a');
    expect(buf.getWindow('a', 10_000, now)).toEqual([]);
  });

  it('clearAll removes all asset history', () => {
    const buf = new MidHistoryBuffer();
    const now = 10_000;
    buf.record('a', 0.5, now);
    buf.record('b', 0.6, now + 600);
    buf.clearAll();
    expect(buf.getWindow('a', 10_000, now + 600)).toEqual([]);
    expect(buf.getWindow('b', 10_000, now + 600)).toEqual([]);
  });
});
