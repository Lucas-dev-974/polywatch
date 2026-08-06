import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPostEntryMidTimers,
  POST_ENTRY_MID_OFFSETS_MS,
  schedulePostEntryMidLog,
} from './post-entry-mid-logger.js';

afterEach(() => {
  clearPostEntryMidTimers();
});

describe('schedulePostEntryMidLog', () => {
  it('schedules +1s/+5s/+30s samples from fill time', () => {
    const timers: Array<{ delay: number; fn: () => void; id: number }> = [];
    const samples: Array<{ offsetMs: number; upMid: number | null }> = [];
    let now = 1_000_000;
    let nextId = 1;

    schedulePostEntryMidLog({
      conditionId: '0xabc',
      outcome: 'YES',
      positionId: 42,
      filledAtMs: now,
      priceFeed: {
        getOutcomePrices: () => ({ upPrice: 0.62, downPrice: 0.38 }),
      },
      setTimeoutFn: ((fn: () => void, delay: number) => {
        const id = nextId++;
        timers.push({ delay, fn, id });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      nowMs: () => now,
      onSample: (s) => samples.push({ offsetMs: s.offsetMs, upMid: s.upMid }),
    });

    expect(timers.map((t) => t.delay)).toEqual([...POST_ENTRY_MID_OFFSETS_MS]);

    now = 1_001_000;
    timers[0]!.fn();
    now = 1_005_000;
    timers[1]!.fn();
    now = 1_030_000;
    timers[2]!.fn();

    expect(samples).toEqual([
      { offsetMs: 1_000, upMid: 0.62 },
      { offsetMs: 5_000, upMid: 0.62 },
      { offsetMs: 30_000, upMid: 0.62 },
    ]);
  });

  it('clamps delay to zero when fill is already in the past', () => {
    const delays: number[] = [];
    let nextId = 1;
    schedulePostEntryMidLog({
      conditionId: '0xabc',
      outcome: 'NO',
      filledAtMs: 0,
      priceFeed: {
        getOutcomePrices: () => ({ upPrice: null, downPrice: 0.55 }),
      },
      setTimeoutFn: ((_fn: () => void, delay: number) => {
        delays.push(delay);
        return (nextId++) as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      nowMs: () => 60_000,
    });
    expect(delays.every((d) => d === 0)).toBe(true);
  });

  it('clearPostEntryMidTimers cancels pending samples', () => {
    const cleared: number[] = [];
    let nextId = 10;
    schedulePostEntryMidLog({
      conditionId: '0xabc',
      outcome: 'YES',
      filledAtMs: Date.now(),
      priceFeed: {
        getOutcomePrices: () => ({ upPrice: 0.5, downPrice: 0.5 }),
      },
      setTimeoutFn: ((_fn: () => void, _delay: number) => {
        return (nextId++) as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
        cleared.push(id as unknown as number);
      }) as typeof clearTimeout,
    });
    clearPostEntryMidTimers();
    expect(cleared).toEqual([10, 11, 12]);
  });
});
