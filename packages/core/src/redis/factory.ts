import { Redis, type RedisOptions } from 'ioredis';

export interface RedisSentinelConfig {
  sentinels: Array<{ host: string; port: number }>;
  name: string;
  password?: string;
  db?: number;
}

export type RedisConnectionConfig =
  | { type: 'url'; url: string }
  | { type: 'sentinel'; sentinel: RedisSentinelConfig };

function parseRedisConfig(): RedisConnectionConfig {
  // Sentinel takes precedence when REDIS_SENTINEL_NAME is set
  const sentinelName = process.env.REDIS_SENTINEL_NAME;
  if (sentinelName) {
    const sentinelHosts = (process.env.REDIS_SENTINEL_HOSTS ?? '127.0.0.1:26379')
      .split(',')
      .map((s) => {
        const [host, portStr] = s.trim().split(':');
        return { host, port: Number(portStr) || 26379 };
      });
    return {
      type: 'sentinel',
      sentinel: {
        sentinels: sentinelHosts,
        name: sentinelName,
        password: process.env.REDIS_SENTINEL_PASSWORD || process.env.REDIS_PASSWORD,
        db: Number(process.env.REDIS_DB) || 0,
      },
    };
  }
  return {
    type: 'url',
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
}

function buildRedisOptions(): RedisOptions {
  const base: RedisOptions = {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    lazyConnect: false,
  };
  return base;
}

/**
 * Create a Redis connection that supports both single-instance and Sentinel
 * high-availability configurations.
 *
 * Single-instance (default):
 *   REDIS_URL=redis://localhost:6379
 *
 * Sentinel HA:
 *   REDIS_SENTINEL_NAME=mymaster
 *   REDIS_SENTINEL_HOSTS=10.0.0.1:26379,10.0.0.2:26379,10.0.0.3:26379
 *   REDIS_SENTINEL_PASSWORD=optional
 *   REDIS_PASSWORD=optional
 *   REDIS_DB=0
 */
export function createRedis(): Redis {
  const cfg = parseRedisConfig();
  const opts = buildRedisOptions();

  if (cfg.type === 'sentinel') {
    return new Redis({
      ...opts,
      sentinels: cfg.sentinel.sentinels,
      name: cfg.sentinel.name,
      password: cfg.sentinel.password,
      db: cfg.sentinel.db,
    });
  }

  return new Redis(cfg.url, opts);
}
