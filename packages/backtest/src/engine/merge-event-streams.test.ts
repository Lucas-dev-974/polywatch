import { describe, expect, it } from 'vitest';
import { mergeEventStreams } from './merge-event-streams.js';
import type { BacktestEvent } from './events.js';

async function* streamOf(events: BacktestEvent[]): AsyncGenerator<BacktestEvent> {
  for (const e of events) yield e;
}

describe('mergeEventStreams', () => {
  it('merges streams by timestamp with stable tie-break', async () => {
    const a = streamOf([
      { kind: 'forecast', at: new Date('2026-01-01T00:00:01Z'), data: {} as never },
      { kind: 'forecast', at: new Date('2026-01-01T00:00:03Z'), data: {} as never },
    ]);
    const b = streamOf([
      { kind: 'book_tick', at: new Date('2026-01-01T00:00:02Z'), data: {} as never },
    ]);

    const out: BacktestEvent[] = [];
    for await (const evt of mergeEventStreams([a, b])) {
      out.push(evt);
    }

    expect(out.map((e) => e.at.toISOString())).toEqual([
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:03.000Z',
    ]);
  });

  it('heapifies initial heads when stream 0 starts later than stream 1', async () => {
    // Reproduces virtual_clock_regression: forecast head at 08:20, tick head at 07:19.
    const forecasts = streamOf([
      { kind: 'forecast', at: new Date('2026-08-08T08:20:45.212Z'), data: {} as never },
      { kind: 'forecast', at: new Date('2026-08-08T08:21:00.000Z'), data: {} as never },
    ]);
    const ticks = streamOf([
      { kind: 'book_tick', at: new Date('2026-08-08T07:19:56.627Z'), data: {} as never },
      { kind: 'book_tick', at: new Date('2026-08-08T08:20:45.212Z'), data: {} as never },
    ]);

    const out: BacktestEvent[] = [];
    for await (const evt of mergeEventStreams([forecasts, ticks])) {
      out.push(evt);
    }

    const times = out.map((e) => e.at.getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    }
    expect(out.map((e) => e.at.toISOString())).toEqual([
      '2026-08-08T07:19:56.627Z',
      '2026-08-08T08:20:45.212Z',
      '2026-08-08T08:20:45.212Z',
      '2026-08-08T08:21:00.000Z',
    ]);
  });
});
