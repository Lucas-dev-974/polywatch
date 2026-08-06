import { describe, expect, it, vi } from 'vitest';
import { algoEntryCooldownKey } from './algo-entry-cooldown.js';
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

  it('purges algo-entry-cooldown by conditionId (not logicalKey)', async () => {
    const conditionId = '0xcond-abc';
    const logicalKey = 'hash-not-a-condition';
    const redis = makeRedis(
      {},
      {
        [algoEntryCooldownKey(conditionId, 'sim')]: '1',
        [algoEntryCooldownKey(conditionId, 'real')]: '1',
        [`algo-entry-cooldown:${logicalKey}:sim`]: '1',
      },
    );

    const result = await purgeSimExecutionRedisState(
      redis as never,
      {
        ...baseHints,
        algoLogicalKeys: [logicalKey],
        conditionIds: [conditionId],
      },
      'crypto',
    );

    expect(result.cooldownKeysRemoved).toBe(1);
    expect(redis._store.has(algoEntryCooldownKey(conditionId, 'sim'))).toBe(false);
    expect(redis._store.has(algoEntryCooldownKey(conditionId, 'real'))).toBe(true);
    // Legacy wrong-shape key left alone (never written by prod).
    expect(redis._store.has(`algo-entry-cooldown:${logicalKey}:sim`)).toBe(true);
  });

  it('purges sim dead-letter jobs and ::retries keys', async () => {
    const algoQueue = WORKER_QUEUES.ALGO_ORDER_SIGNALS;
    const dead = `${algoQueue}:dead`;
    const simJob = JSON.stringify({
      id: 'sig-sim-dead',
      mode: 'sim',
      reason: 'ALGO_OPEN',
      copiedPositionId: 1,
    });
    const realJob = JSON.stringify({
      id: 'sig-real-dead',
      mode: 'real',
      reason: 'ALGO_OPEN',
      copiedPositionId: 2,
    });
    const redis = makeRedis(
      { [dead]: [simJob, realJob] },
      {
        [`${simJob}::retries`]: '2',
        [`${realJob}::retries`]: '1',
      },
    );

    const result = await purgeSimExecutionRedisState(
      redis as never,
      baseHints,
      'crypto',
    );

    expect(result.deadLetterRemoved).toBe(1);
    expect(result.jobRetryKeysRemoved).toBe(1);
    expect(redis._lists.get(dead)).toEqual([realJob]);
    expect(redis._store.has(`${simJob}::retries`)).toBe(false);
    expect(redis._store.has(`${realJob}::retries`)).toBe(true);
  });

  it('purges weather-close enqueueUnique markers for wiped positions', async () => {
    const closeQueue = WORKER_QUEUES.CLOSE_SIGNALS;
    const redis = makeRedis(
      {},
      {
        [`${closeQueue}:enqueued:weather-close:42:WEATHER_BUCKET_EXIT`]: '1',
        [`${closeQueue}:retry-cooldown:weather-close:42:WEATHER_FORECAST_CHANGE`]: '1',
        [`${closeQueue}:enqueued:weather-close:99:WEATHER_BUCKET_EXIT`]: '1',
      },
    );

    await purgeSimExecutionRedisState(
      redis as never,
      { ...baseHints, copiedPositionIds: [42] },
      'weather',
    );

    expect(
      redis._store.has(`${closeQueue}:enqueued:weather-close:42:WEATHER_BUCKET_EXIT`),
    ).toBe(false);
    expect(
      redis._store.has(
        `${closeQueue}:retry-cooldown:weather-close:42:WEATHER_FORECAST_CHANGE`,
      ),
    ).toBe(false);
    expect(
      redis._store.has(`${closeQueue}:enqueued:weather-close:99:WEATHER_BUCKET_EXIT`),
    ).toBe(true);
  });
});
