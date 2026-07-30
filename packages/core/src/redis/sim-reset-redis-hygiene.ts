import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Market } from '../entities/Market.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { hashAlgoLogicalKey } from '../idempotence/hash.js';
import { resolveMarketInterval } from '../risk/crypto-algo-exit.js';
import { WORKER_QUEUES } from '../queue/worker-queues.js';
import type { ExecutionResult, OrderSignal } from '../types/index.js';
import { algoKindFromReason, type SimAlgoKind } from '../simulation/algo-kind.js';
import { RiskService } from '../services/risk.service.js';

const ALGO_QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;
const WEATHER_QUEUE = WORKER_QUEUES.WEATHER_ORDER_SIGNALS;
const COPY_QUEUE = WORKER_QUEUES.ORDER_SIGNALS;
const CLOSE_QUEUE = WORKER_QUEUES.CLOSE_SIGNALS;
const RESULTS_QUEUE = WORKER_QUEUES.EXECUTION_RESULTS;

export interface SimRedisPurgeHints {
  algoLogicalKeys: string[];
  janitorDedupeKeys: string[];
  copySignalIds: string[];
  copiedPositionIds: number[];
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

/** Entry/open reasons only — never use for SL/TP/TRAILING close signals. */
function entryJobMatchesAlgoKind(raw: string, algoKind: SimAlgoKind): boolean {
  try {
    const job = JSON.parse(raw) as OrderSignal;
    if (job.mode !== 'sim') return false;
    if (!job.reason) return false;
    return algoKindFromReason(job.reason) === algoKind;
  } catch {
    return false;
  }
}

/** Algo-specific reasons (entry or exit) — excludes shared SL/TP/TRAILING/MANUAL. */
function isAlgoSpecificReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    reason.startsWith('ALGO_') ||
    reason.startsWith('COPY_') ||
    reason.startsWith('WEATHER_')
  );
}

function entryReasonForAlgoKind(algoKind: SimAlgoKind): string[] {
  switch (algoKind) {
    case 'weather':
      return ['WEATHER_OPEN', 'WEATHER_INCREASE'];
    case 'copy':
      return ['COPY_OPEN', 'COPY_INCREASE'];
    default:
      return ['ALGO_OPEN', 'ALGO_INCREASE'];
  }
}

/**
 * Snapshot sim-related Redis purge targets from DB **before** reset deletes rows.
 * Scoped to a single algoKind perimeter.
 */
export async function collectSimRedisPurgeHints(
  ds: DataSource,
  algoKind: SimAlgoKind,
): Promise<SimRedisPurgeHints> {
  const allReservations = await ds.getRepository(PositionReservation).find({
    where: { mode: 'sim' },
  });
  const reservations = allReservations.filter(
    (r) => algoKindFromReason(r.reason) === algoKind,
  );

  const allSimPositions = await ds.getRepository(CopiedPosition).find({
    where: { mode: 'sim' },
  });
  const scopedPositions = allSimPositions.filter(
    (p) => algoKindFromReason(p.reason) === algoKind,
  );
  const copiedPositionIds = scopedPositions.map((p) => p.id);
  const posById = new Map(scopedPositions.map((p) => [p.id, p]));

  const entryReasons = entryReasonForAlgoKind(algoKind);
  const pendingEntries = scopedPositions.filter(
    (p) =>
      p.status === 'pending' &&
      p.reason != null &&
      entryReasons.includes(p.reason),
  );

  const risk = await new RiskService(ds).getCryptoConfig();
  const strategies = parseStrategies(risk.cryptoAlgoStrategies ?? null);

  const conditionIds = [
    ...new Set([
      ...reservations.map((r) => r.conditionId),
      ...scopedPositions.map((p) => p.conditionId),
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
    if (algoKind === 'copy') continue;
    if (
      reservation.reason !== 'ALGO_OPEN' &&
      reservation.reason !== 'WEATHER_OPEN'
    ) {
      continue;
    }

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

  const janitorDedupeKeys = pendingEntries.map((p) => `janitor:${p.id}`);

  return {
    algoLogicalKeys: [...algoLogicalKeys],
    janitorDedupeKeys,
    copySignalIds: [...copySignalIds],
    copiedPositionIds,
  };
}

async function removeSimEntryJobsFromList(
  redis: Redis,
  queueName: string,
  algoKind: SimAlgoKind,
): Promise<number> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  for (const raw of items) {
    if (!entryJobMatchesAlgoKind(raw, algoKind)) continue;
    const count = await redis.lrem(queueName, 0, raw);
    if (count > 0) removed += count;
  }
  return removed;
}

async function removeSimCloseJobsFromList(
  redis: Redis,
  queueName: string,
  copiedPositionIds: Set<number>,
): Promise<{ removed: number; closeSignalIds: Set<string> }> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  const closeSignalIds = new Set<string>();
  for (const raw of items) {
    if (!isSimJob(raw)) continue;
    try {
      const job = JSON.parse(raw) as OrderSignal;
      if (!copiedPositionIds.has(job.copiedPositionId)) continue;
      closeSignalIds.add(job.id);
      const count = await redis.lrem(queueName, 0, raw);
      if (count > 0) removed += count;
    } catch {
      /* skip */
    }
  }
  return { removed, closeSignalIds };
}

async function removeSimExecutionResultsFromList(
  redis: Redis,
  queueName: string,
  hints: SimRedisPurgeHints,
  closeSignalIds: Set<string>,
  algoKind: SimAlgoKind,
): Promise<number> {
  const reservationIds = new Set(hints.copySignalIds);
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  for (const raw of items) {
    if (!isSimJob(raw)) continue;
    try {
      const job = JSON.parse(raw) as ExecutionResult;
      const matchBySignal =
        reservationIds.has(job.orderSignalId) ||
        closeSignalIds.has(job.orderSignalId);
      // Gate with isAlgoSpecificReason first so SL/TP/… never map via algoKindFromReason.
      const matchByReason =
        isAlgoSpecificReason(job.reason) &&
        algoKindFromReason(job.reason) === algoKind;
      if (!matchBySignal && !matchByReason) continue;
      const count = await redis.lrem(queueName, 0, raw);
      if (count > 0) removed += count;
    } catch {
      /* skip */
    }
  }
  return removed;
}

/**
 * Purge sim execution state from Redis using hints collected before DB reset.
 * Scoped to a single algoKind — never wipes other algos' queues.
 */
export async function purgeSimExecutionRedisState(
  redis: Redis,
  hints: SimRedisPurgeHints,
  algoKind: SimAlgoKind,
): Promise<SimResetRedisPurgeResult> {
  let algoOrderSignalsRemoved = 0;
  let orderSignalsRemoved = 0;

  if (algoKind === 'crypto') {
    algoOrderSignalsRemoved =
      (await removeSimEntryJobsFromList(redis, ALGO_QUEUE, algoKind)) +
      (await removeSimEntryJobsFromList(redis, processingKey(ALGO_QUEUE), algoKind));
  } else if (algoKind === 'weather') {
    algoOrderSignalsRemoved =
      (await removeSimEntryJobsFromList(redis, WEATHER_QUEUE, algoKind)) +
      (await removeSimEntryJobsFromList(
        redis,
        processingKey(WEATHER_QUEUE),
        algoKind,
      ));
  } else if (algoKind === 'copy') {
    orderSignalsRemoved =
      (await removeSimEntryJobsFromList(redis, COPY_QUEUE, algoKind)) +
      (await removeSimEntryJobsFromList(redis, processingKey(COPY_QUEUE), algoKind));
  }

  const positionIdSet = new Set(hints.copiedPositionIds);
  const closeMain = await removeSimCloseJobsFromList(
    redis,
    CLOSE_QUEUE,
    positionIdSet,
  );
  const closeProcessing = await removeSimCloseJobsFromList(
    redis,
    processingKey(CLOSE_QUEUE),
    positionIdSet,
  );
  const closeSignalsRemoved = closeMain.removed + closeProcessing.removed;
  const allCloseSignalIds = new Set([
    ...closeMain.closeSignalIds,
    ...closeProcessing.closeSignalIds,
  ]);

  const executionResultsRemoved =
    (await removeSimExecutionResultsFromList(
      redis,
      RESULTS_QUEUE,
      hints,
      allCloseSignalIds,
      algoKind,
    )) +
    (await removeSimExecutionResultsFromList(
      redis,
      processingKey(RESULTS_QUEUE),
      hints,
      allCloseSignalIds,
      algoKind,
    ));

  const markerKeysToDelete: string[] = [];
  const queueForAlgo =
    algoKind === 'weather'
      ? WEATHER_QUEUE
      : algoKind === 'copy'
        ? COPY_QUEUE
        : ALGO_QUEUE;

  for (const logicalKey of hints.algoLogicalKeys) {
    markerKeysToDelete.push(...markerKeys(ALGO_QUEUE, logicalKey));
    if (algoKind === 'weather') {
      markerKeysToDelete.push(...markerKeys(WEATHER_QUEUE, logicalKey));
    }
  }
  for (const janitorKey of hints.janitorDedupeKeys) {
    markerKeysToDelete.push(...markerKeys(queueForAlgo, janitorKey));
  }
  for (const signalId of hints.copySignalIds) {
    markerKeysToDelete.push(...markerKeys(COPY_QUEUE, signalId));
  }

  let dedupeMarkersRemoved = 0;
  let retryMarkersRemoved = 0;
  if (markerKeysToDelete.length > 0) {
    const existing = await Promise.all(
      markerKeysToDelete.map(async (key) =>
        (await redis.exists(key)) === 1 ? key : null,
      ),
    );
    const toDelete = existing.filter((k): k is string => k != null);
    if (toDelete.length > 0) {
      dedupeMarkersRemoved = toDelete.filter((k) => k.includes(':enqueued:')).length;
      retryMarkersRemoved = toDelete.length - dedupeMarkersRemoved;
      await redis.del(...toDelete);
    }
  }

  let cooldownKeysRemoved = 0;
  for (const logicalKey of hints.algoLogicalKeys) {
    const key = `algo-entry-cooldown:${logicalKey}:sim`;
    if ((await redis.exists(key)) === 1) {
      cooldownKeysRemoved += await redis.del(key);
    }
  }

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

/** @deprecated Use entryJobMatchesAlgoKind — kept for unit tests importing old name. */
export function jobMatchesAlgoKindForTests(
  raw: string,
  algoKind: SimAlgoKind,
): boolean {
  return entryJobMatchesAlgoKind(raw, algoKind);
}
