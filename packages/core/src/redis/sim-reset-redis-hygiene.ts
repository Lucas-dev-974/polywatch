import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Market } from '../entities/Market.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { hashAlgoLogicalKey } from '../idempotence/hash.js';
import { resolveMarketInterval } from '../risk/crypto-algo-exit.js';
import { WORKER_QUEUES } from '../queue/worker-queues.js';
import type { OrderSignal } from '../types/index.js';

const ALGO_QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;
const COPY_QUEUE = WORKER_QUEUES.ORDER_SIGNALS;

const SIM_LIST_QUEUES = [
  WORKER_QUEUES.ALGO_ORDER_SIGNALS,
  WORKER_QUEUES.ORDER_SIGNALS,
  WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
  WORKER_QUEUES.EXECUTION_RESULTS,
  WORKER_QUEUES.CLOSE_SIGNALS,
] as const;

export interface SimRedisPurgeHints {
  algoLogicalKeys: string[];
  janitorDedupeKeys: string[];
  copySignalIds: string[];
}

export interface SimResetRedisPurgeResult {
  algoOrderSignalsRemoved: number;
  orderSignalsRemoved: number;
  executionResultsRemoved: number;
  closeSignalsRemoved: number;
  dedupeMarkersRemoved: number;
  retryMarkersRemoved: number;
  cooldownKeysRemoved: number;
}

function processingKey(queueName: string): string {
  return `${queueName}:processing`;
}

function parseStrategies(raw: string | null | undefined): string[] {
  if (!raw) return ['naive-momentum'];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed.length > 0 ? parsed : ['naive-momentum'];
    }
  } catch {
    /* fall through */
  }
  return ['naive-momentum'];
}

function markerKeys(queueName: string, dedupeKey: string): string[] {
  return [
    `${queueName}:enqueued:${dedupeKey}`,
    `${queueName}:retry-cooldown:${dedupeKey}`,
    `${queueName}:retry-count:${dedupeKey}`,
  ];
}

function isSimJob(raw: string): boolean {
  try {
    const job = JSON.parse(raw) as { mode?: string };
    return job.mode === 'sim';
  } catch {
    return false;
  }
}

/**
 * Snapshot sim-related Redis purge targets from DB **before** reset deletes rows.
 */
export async function collectSimRedisPurgeHints(
  ds: DataSource,
): Promise<SimRedisPurgeHints> {
  const reservations = await ds.getRepository(PositionReservation).find({
    where: { mode: 'sim' },
  });

  const pendingAlgo = await ds.getRepository(CopiedPosition).find({
    where: {
      mode: 'sim',
      status: 'pending',
      reason: In(['ALGO_OPEN', 'WEATHER_OPEN']),
    },
  });

  const positionIds = [
    ...new Set([
      ...reservations.map((r) => r.copiedPositionId),
      ...pendingAlgo.map((p) => p.id),
    ]),
  ];
  const positions =
    positionIds.length > 0
      ? await ds.getRepository(CopiedPosition).find({ where: { id: In(positionIds) } })
      : [];
  const posById = new Map(positions.map((p) => [p.id, p]));

  const risk = await ds.getRepository(RiskConfig).findOne({ where: {} });
  const strategies = parseStrategies(risk?.cryptoAlgoStrategies ?? null);

  const conditionIds = [
    ...new Set([
      ...reservations.map((r) => r.conditionId),
      ...pendingAlgo.map((p) => p.conditionId),
    ]),
  ];

  const markets =
    conditionIds.length > 0
      ? await ds.getRepository(Market).find({
          where: { conditionId: In(conditionIds) },
        })
      : [];
  const marketByCondition = new Map(markets.map((m) => [m.conditionId, m]));

  const algoLogicalKeys = new Set<string>();
  const copySignalIds = new Set<string>();

  for (const reservation of reservations) {
    copySignalIds.add(reservation.orderSignalId);
    if (reservation.reason !== 'ALGO_OPEN' && reservation.reason !== 'WEATHER_OPEN') continue;

    const pos = posById.get(reservation.copiedPositionId);
    const outcome = pos?.outcome ?? 'YES';
    const market = marketByCondition.get(reservation.conditionId);
    const interval = resolveMarketInterval(market ?? null, null) ?? '5m';

    for (const strategyId of strategies) {
      algoLogicalKeys.add(
        hashAlgoLogicalKey({
          conditionId: reservation.conditionId,
          interval,
          outcome,
          strategyId,
          mode: 'sim',
        }),
      );
    }
  }

  const janitorDedupeKeys = pendingAlgo.map((p) => `janitor:${p.id}`);

  return {
    algoLogicalKeys: [...algoLogicalKeys],
    janitorDedupeKeys,
    copySignalIds: [...copySignalIds],
  };
}

async function removeSimJobsFromList(
  redis: Redis,
  queueName: string,
): Promise<number> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  for (const raw of items) {
    if (!isSimJob(raw)) continue;
    const count = await redis.lrem(queueName, 0, raw);
    if (count > 0) removed += count;
  }
  return removed;
}

async function scanDeleteByPattern(
  redis: Redis,
  pattern: string,
): Promise<number> {
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) {
      removed += await redis.del(...keys);
    }
  } while (cursor !== '0');
  return removed;
}

/**
 * Purge sim execution state from Redis using hints collected before DB reset.
 */
export async function purgeSimExecutionRedisState(
  redis: Redis,
  hints: SimRedisPurgeHints,
): Promise<SimResetRedisPurgeResult> {
  const algoOrderSignalsRemoved =
    (await removeSimJobsFromList(redis, ALGO_QUEUE)) +
    (await removeSimJobsFromList(redis, processingKey(ALGO_QUEUE)));

  const orderSignalsRemoved =
    (await removeSimJobsFromList(redis, COPY_QUEUE)) +
    (await removeSimJobsFromList(redis, processingKey(COPY_QUEUE)));

  const executionResultsRemoved =
    (await removeSimJobsFromList(redis, WORKER_QUEUES.EXECUTION_RESULTS)) +
    (await removeSimJobsFromList(redis, processingKey(WORKER_QUEUES.EXECUTION_RESULTS)));

  const closeSignalsRemoved =
    (await removeSimJobsFromList(redis, WORKER_QUEUES.CLOSE_SIGNALS)) +
    (await removeSimJobsFromList(redis, processingKey(WORKER_QUEUES.CLOSE_SIGNALS)));

  const markerKeysToDelete: string[] = [];
  for (const logicalKey of hints.algoLogicalKeys) {
    markerKeysToDelete.push(...markerKeys(ALGO_QUEUE, logicalKey));
  }
  for (const janitorKey of hints.janitorDedupeKeys) {
    markerKeysToDelete.push(...markerKeys(ALGO_QUEUE, janitorKey));
  }
  for (const signalId of hints.copySignalIds) {
    markerKeysToDelete.push(...markerKeys(COPY_QUEUE, signalId));
  }

  let dedupeMarkersRemoved = 0;
  let retryMarkersRemoved = 0;
  if (markerKeysToDelete.length > 0) {
    const existing = await Promise.all(
      markerKeysToDelete.map(async (key) => ((await redis.exists(key)) === 1 ? key : null)),
    );
    const toDelete = existing.filter((k): k is string => k != null);
    if (toDelete.length > 0) {
      dedupeMarkersRemoved = toDelete.filter((k) => k.includes(':enqueued:')).length;
      retryMarkersRemoved = toDelete.length - dedupeMarkersRemoved;
      await redis.del(...toDelete);
    }
  }

  const cooldownKeysRemoved = await scanDeleteByPattern(
    redis,
    'algo-entry-cooldown:*:sim',
  );

  return {
    algoOrderSignalsRemoved,
    orderSignalsRemoved,
    executionResultsRemoved,
    closeSignalsRemoved,
    dedupeMarkersRemoved,
    retryMarkersRemoved,
    cooldownKeysRemoved,
  };
}

/** Parse jobs from a Redis list (test helper). */
export function parseQueueJobs(rawItems: string[]): OrderSignal[] {
  const out: OrderSignal[] = [];
  for (const raw of rawItems) {
    try {
      out.push(JSON.parse(raw) as OrderSignal);
    } catch {
      /* skip */
    }
  }
  return out;
}
