import { Router } from 'express';
import { WORKER_QUEUES, CRYPTO_ALGO_RUNTIME_STATUS_KEY, parseCryptoAlgoRuntimeStatus } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { getRedis } from '../redis.js';
import type { DataSource } from 'typeorm';

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const COPY_TRADING_HEARTBEAT_KEY = 'copy-trading:heartbeat';
const CRYPTO_ALGO_HEARTBEAT_KEY = 'crypto-algo:heartbeat';
const HEARTBEAT_MAX_AGE_MS = 90_000; // marge pour le jitter (TTL 60s, intervalle 30s)

interface ProcessStatus {
  name: string;
  alive: boolean;
  lastSeenAt: string | null;
  uptimeSeconds: number | null;
  pid: number | null;
  extra?: Record<string, unknown>;
}

interface RedisQueueStatus {
  name: string;
  depth: number;
  processing: number;
  dead?: number;
}

interface ServiceHealth {
  redis: 'ok' | 'down';
  postgres: 'ok' | 'down';
  backend: 'ok' | 'down';
}

interface SystemOverviewResponse {
  generatedAt: string;
  backend: {
    pid: number;
    uptimeSeconds: number;
    status: 'ok' | 'degraded';
  };
  services: ServiceHealth;
  processes: ProcessStatus[];
  queues: RedisQueueStatus[];
}

function processingKey(queueName: string): string {
  return `${queueName}:processing`;
}

function deadLetterKey(queueName: string): string {
  return `${queueName}:dead`;
}

function readHeartbeat(
  value: string | null,
): { alive: boolean; lastSeenAt: string | null } {
  if (!value) return { alive: false, lastSeenAt: null };
  const ts = Number(value);
  if (!Number.isFinite(ts)) return { alive: false, lastSeenAt: null };
  return {
    alive: Date.now() - ts <= HEARTBEAT_MAX_AGE_MS,
    lastSeenAt: new Date(ts).toISOString(),
  };
}

export function createSystemOverviewRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/overview', requireJwt, async (_req, res) => {
    const redis = getRedis();

    // 1. Backend self-status
    const backendStatus: SystemOverviewResponse['backend'] = {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      status: 'ok',
    };

    // 2-3. Redis + PostgreSQL health (en parallèle)
    const [redisPingOk, pgOk] = await Promise.all([
      redis.ping().then(() => true as const).catch(() => false as const),
      ds.query('SELECT 1').then(() => true as const).catch(() => false as const),
    ]);

    const services: ServiceHealth = {
      redis: redisPingOk ? 'ok' : 'down',
      postgres: pgOk ? 'ok' : 'down',
      backend: 'ok',
    };

    // 4. Processus via heartbeats
    const [workerHb, copyHb, cryptoHb, runtimeRaw] = await Promise.all([
      redis.get(WORKER_HEARTBEAT_KEY),
      redis.get(COPY_TRADING_HEARTBEAT_KEY),
      redis.get(CRYPTO_ALGO_HEARTBEAT_KEY),
      redis.get(CRYPTO_ALGO_RUNTIME_STATUS_KEY),
    ]);

    const worker = readHeartbeat(workerHb);
    const copyTrading = readHeartbeat(copyHb);
    const crypto = readHeartbeat(cryptoHb);
    const runtimeStatus = parseCryptoAlgoRuntimeStatus(runtimeRaw);

    const processes: ProcessStatus[] = [
      {
        name: 'worker',
        alive: worker.alive,
        lastSeenAt: worker.lastSeenAt,
        uptimeSeconds: null,
        pid: null,
      },
      {
        name: 'copy-trading',
        alive: copyTrading.alive,
        lastSeenAt: copyTrading.lastSeenAt,
        uptimeSeconds: null,
        pid: null,
      },
      {
        name: 'crypto-algo',
        alive: crypto.alive,
        lastSeenAt: crypto.lastSeenAt,
        uptimeSeconds: null,
        pid: null,
        extra: runtimeStatus ? { ...runtimeStatus } : undefined,
      },
    ];

    // 5. Files Redis
    const queueNames = [
      WORKER_QUEUES.ALGO_ORDER_SIGNALS,
      WORKER_QUEUES.ORDER_SIGNALS,
      WORKER_QUEUES.EXECUTION_RESULTS,
      WORKER_QUEUES.CLOSE_SIGNALS,
      WORKER_QUEUES.MOVE_EVENTS,
    ] as const;

    const queueResults = await Promise.all(
      queueNames.map((name) =>
        Promise.all([
          redis.llen(name),
          redis.llen(processingKey(name)),
          redis.llen(deadLetterKey(name)),
        ]).then(([depth, processing, dead]) => ({
          name,
          depth,
          processing,
          dead,
        })),
      ),
    );

    const body: SystemOverviewResponse = {
      generatedAt: new Date().toISOString(),
      backend: backendStatus,
      services,
      processes,
      queues: queueResults,
    };

    res.json(body);
  });

  return router;
}
