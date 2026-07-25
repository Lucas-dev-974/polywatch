import { Router } from 'express';
import { WORKER_QUEUES } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { getRedis } from '../redis.js';

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_MAX_AGE_MS = 60_000;
const DEPTH_WARNING = 10;
const DEPTH_CRITICAL = 50;

export type WorkerQueueStatusLevel = 'ok' | 'warning' | 'critical';

export interface AlgoWorkerQueueStatusResponse {
  workerAlive: boolean;
  workerLastSeenAt: string | null;
  algoOrderSignalsDepth: number;
  algoOrderSignalsProcessing: number;
  orderSignalsDepth: number;
  executionResultsDepth: number;
  level: WorkerQueueStatusLevel;
  hint: string | null;
}

function processingKey(queueName: string): string {
  return `${queueName}:processing`;
}

function resolveLevel(
  workerAlive: boolean,
  algoDepth: number,
): { level: WorkerQueueStatusLevel; hint: string | null } {
  if (algoDepth >= DEPTH_CRITICAL) {
    return {
      level: 'critical',
      hint: `File algo saturée (${algoDepth} jobs) — vérifier worker et BRPOPLPUSH`,
    };
  }
  if (!workerAlive && algoDepth > 0) {
    return {
      level: 'critical',
      hint: 'Worker hors ligne avec jobs en attente',
    };
  }
  if (algoDepth >= DEPTH_WARNING) {
    return {
      level: 'warning',
      hint: `File algo en croissance (${algoDepth} jobs)`,
    };
  }
  if (!workerAlive) {
    return {
      level: 'warning',
      hint: 'Worker hors ligne (heartbeat expiré)',
    };
  }
  return { level: 'ok', hint: null };
}

export function createAlgoWorkerQueueStatusRouter(): Router {
  const router = Router();

  router.get('/worker-queue-status', requireJwt, async (_req, res) => {
    const redis = getRedis();
    const algoQueue = WORKER_QUEUES.ALGO_ORDER_SIGNALS;

    const [
      heartbeatValue,
      algoDepth,
      algoProcessing,
      orderDepth,
      executionDepth,
    ] = await Promise.all([
      redis.get(WORKER_HEARTBEAT_KEY),
      redis.llen(algoQueue),
      redis.llen(processingKey(algoQueue)),
      redis.llen(WORKER_QUEUES.ORDER_SIGNALS),
      redis.llen(WORKER_QUEUES.EXECUTION_RESULTS),
    ]);

    let workerAlive = false;
    let workerLastSeenAt: string | null = null;
    if (heartbeatValue) {
      const ts = Number(heartbeatValue);
      if (Number.isFinite(ts)) {
        workerLastSeenAt = new Date(ts).toISOString();
        workerAlive = Date.now() - ts <= HEARTBEAT_MAX_AGE_MS;
      }
    }

    const { level, hint } = resolveLevel(workerAlive, algoDepth);

    const body: AlgoWorkerQueueStatusResponse = {
      workerAlive,
      workerLastSeenAt,
      algoOrderSignalsDepth: algoDepth,
      algoOrderSignalsProcessing: algoProcessing,
      orderSignalsDepth: orderDepth,
      executionResultsDepth: executionDepth,
      level,
      hint,
    };

    res.json(body);
  });

  return router;
}
