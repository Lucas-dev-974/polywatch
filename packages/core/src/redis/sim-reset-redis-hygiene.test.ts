import { describe, expect, it, vi } from 'vitest';
import { purgeSimExecutionRedisState, type SimRedisPurgeHints } from './sim-reset-redis-hygiene.js';
import { WORKER_QUEUES } from '../queue/worker-queues.js';

function makeRedis(lists: Record<string, string[]>, keys: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(keys));
  const listStore = new Map<string, string[]>(Object.entries(lists));
  return {
    lrange: vi.fn(async (key: string) => [...(listStore.get(key) ?? [])]),
    lrem: vi.fn(async (key: string, _count: number, value: string) => {
      const items = listStore.get(key) ?? [];
      const idx = items.indexOf(value);
      if (idx < 0) return 0;
      items.splice(idx, 1);
      return 1;
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    del: vi.fn(async (...ks: string[]) => {
      let n = 0;
      for (const k of ks) {
        if (store.delete(k)) n += 1;
      }
      return n;
    }),
    _lists: listStore,
    _store: store,
  };
}

const baseHints: SimRedisPurgeHints = {
  algoLogicalKeys: [],
  janitorDedupeKeys: [],
  copySignalIds: [],
  copiedPositionIds: [],
};

describe('purgeSimExecutionRedisState — copy phantom re-entry', () => {
  it('drains move-events for watchlist sim traders and removes dedupe markers', async () => {
    const moveQueue = WORKER_QUEUES.MOVE_EVENTS;
    const simJob = JSON.stringify({ id: 'mv-sim-1', traderAddress: '0xsim1' });
    const otherJob = JSON.stringify({ id: 'mv-other-1', traderAddress: '0xother1' });
    const redis = makeRedis(
      { [moveQueue]: [simJob, otherJob], [`${moveQueue}:processing`]: [] },
      {
        [`${moveQueue}:enqueued:mv-sim-1`]: '1',
        [`${moveQueue}:enqueued:mv-other-1`]: '1',
      },
    );

    const result = await purgeSimExecutionRedisState(
      redis as never,
      { ...baseHints, simWatchlistTraders: ['0xsim1'] },
      'copy',
    );

    expect(result.moveEventsRemoved).toBe(1);
    expect(redis._lists.get(moveQueue)).toEqual([otherJob]);
    expect(redis._store.has(`${moveQueue}:enqueued:mv-sim-1`)).toBe(false);
    expect(redis._store.has(`${moveQueue}:enqueued:mv-other-1`)).toBe(true);
  });

  it('purges weather reentry throttles and hysteresis for wiped positions', async () => {
    const redis = makeRedis(
      {},
      {
        'weather-reentry:paris:sim': '1',
        'weather-reentry:paris:real': '1',
        'weather-bucket-hysteresis:42': '3',
      },
    );

    const result = await purgeSimExecutionRedisState(
      redis as never,
      { ...baseHints, weatherCities: ['Paris'], copiedPositionIds: [42] },
      'weather',
    );

    expect(result.weatherReentryKeysRemoved).toBe(1);
    expect(result.weatherHysteresisKeysRemoved).toBe(1);
    expect(redis._store.has('weather-reentry:paris:sim')).toBe(false);
    expect(redis._store.has('weather-reentry:paris:real')).toBe(true);
    expect(redis._store.has('weather-bucket-hysteresis:42')).toBe(false);
  });
});
