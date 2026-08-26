import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Market } from '../entities/Market.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';
import { hashAlgoLogicalKey } from '../idempotence/hash.js';
import { resolveMarketInterval } from '../risk/crypto-algo-exit.js';
import { deadLetterQueueKey, WORKER_QUEUES } from '../queue/worker-queues.js';
import { algoEntryCooldownKey } from './algo-entry-cooldown.js';
import { weatherReentryThrottleKey } from './weather-reentry-throttle.js';
import { weatherReentryCountKey } from './weather-reentry-count.js';
import { WEATHER_STRATEGY_IDS } from '../weather/strategy-catalog.js';
import { weatherBucketHysteresisKey } from './weather-bucket-hysteresis.js';
import { normalizeWeatherCity } from '../weather/weather-exit-helpers.js';
import type { ExecutionResult, OrderSignal } from '../types/index.js';
import { algoKindFromReason, type SimAlgoKind } from '../simulation/algo-kind.js';
import { RiskService } from '../services/risk.service.js';

/** Weather close dedupe keys used by weather-exit-evaluator enqueueUnique. */
const WEATHER_CLOSE_DEDUPE_REASONS = [
  'WEATHER_FORECAST_CHANGE',
  'WEATHER_BUCKET_EXIT',
] as const;

const ALGO_QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;
const WEATHER_QUEUE = WORKER_QUEUES.WEATHER_ORDER_SIGNALS;
const COPY_QUEUE = WORKER_QUEUES.ORDER_SIGNALS;
const CLOSE_QUEUE = WORKER_QUEUES.CLOSE_SIGNALS;
const RESULTS_QUEUE = WORKER_QUEUES.EXECUTION_RESULTS;
const MOVE_EVENTS_QUEUE = WORKER_QUEUES.MOVE_EVENTS;

export interface SimRedisPurgeHints {
  algoLogicalKeys: string[];
  janitorDedupeKeys: string[];
  copySignalIds: string[];
  copiedPositionIds: number[];
  /**
   * Market conditionIds for wiped sim reservations/positions — used to clear
   * `algo-entry-cooldown:{conditionId}:sim` (keyed by conditionId, not logicalKey).
   */
  conditionIds?: string[];
  /** Watchlist sim traders — used to drain `move-events` for sim copy reset. */
  simWatchlistTraders?: string[];
  /** Weather (city, targetDate) pairs with wiped positions — used to clear reentry throttles. */
  weatherCityDates?: Array<{ city: string; dateIso: string }>;
}

export interface SimResetRedisPurgeResult {
  algoOrderSignalsRemoved: number;
  orderSignalsRemoved: number;
  executionResultsRemoved: number;
  closeSignalsRemoved: number;
  dedupeMarkersRemoved: number;
  retryMarkersRemoved: number;
  cooldownKeysRemoved: number;
  moveEventsRemoved?: number;
  weatherReentryKeysRemoved?: number;
  weatherEntryCountKeysRemoved?: number;
  weatherHysteresisKeysRemoved?: number;
  /** Sim-filtered jobs removed from `${queue}:dead` lists. */
  deadLetterRemoved?: number;
  /** `${raw}::retries` keys deleted after LREM (main/processing/dead). */
  jobRetryKeysRemoved?: number;
}

function processingKey(queueName: string): string {
  return `${queueName}:processing`;
}

/** RedisQueue retry counter for a concrete list payload (`redis-queue.ts`). */
function jobRetryKey(raw: string): string {
  return `${raw}::retries`;
}

async function deleteJobRetryKey(redis: Redis, raw: string): Promise<number> {
  return redis.del(jobRetryKey(raw));
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

  const simWatchlistTraders: string[] =
    algoKind === 'copy'
      ? (
          await ds.getRepository(WatchlistEntry).find({
            where: { active: true, simEnabled: true },
          })
        ).map((t) => t.traderAddress)
      : [];

  let weatherCityDates: Array<{ city: string; dateIso: string }> = [];
  if (algoKind === 'weather' && copiedPositionIds.length > 0) {
    const forecasts = await ds.getRepository(WeatherPositionForecast).find({
      where: { copiedPositionId: In(copiedPositionIds) },
    });
    const seen = new Set<string>();
    for (const f of forecasts) {
      if (!f.city) continue;
      const dateIso = f.targetDate.toISOString().slice(0, 10);
      const key = `${normalizeWeatherCity(f.city)}|${dateIso}`;
      if (seen.has(key)) continue;
      seen.add(key);
      weatherCityDates.push({ city: normalizeWeatherCity(f.city), dateIso });
    }
  }

  return {
    algoLogicalKeys: [...algoLogicalKeys],
    janitorDedupeKeys,
    copySignalIds: [...copySignalIds],
    copiedPositionIds,
    conditionIds,
    simWatchlistTraders,
    weatherCityDates,
  };
}

async function removeSimEntryJobsFromList(
  redis: Redis,
  queueName: string,
  algoKind: SimAlgoKind,
): Promise<{ removed: number; retryKeysRemoved: number }> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  let retryKeysRemoved = 0;
  for (const raw of items) {
    if (!entryJobMatchesAlgoKind(raw, algoKind)) continue;
    const count = await redis.lrem(queueName, 0, raw);
    if (count > 0) {
      removed += count;
      retryKeysRemoved += await deleteJobRetryKey(redis, raw);
    }
  }
  return { removed, retryKeysRemoved };
}

async function removeSimCloseJobsFromList(
  redis: Redis,
  queueName: string,
  copiedPositionIds: Set<number>,
): Promise<{ removed: number; closeSignalIds: Set<string>; retryKeysRemoved: number }> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  let retryKeysRemoved = 0;
  const closeSignalIds = new Set<string>();
  for (const raw of items) {
    if (!isSimJob(raw)) continue;
    try {
      const job = JSON.parse(raw) as OrderSignal;
      if (!copiedPositionIds.has(job.copiedPositionId)) continue;
      closeSignalIds.add(job.id);
      const count = await redis.lrem(queueName, 0, raw);
      if (count > 0) {
        removed += count;
        retryKeysRemoved += await deleteJobRetryKey(redis, raw);
      }
    } catch {
      /* skip */
    }
  }
  return { removed, closeSignalIds, retryKeysRemoved };
}

async function removeSimExecutionResultsFromList(
  redis: Redis,
  queueName: string,
  hints: SimRedisPurgeHints,
  closeSignalIds: Set<string>,
  algoKind: SimAlgoKind,
): Promise<{ removed: number; retryKeysRemoved: number }> {
  const reservationIds = new Set(hints.copySignalIds);
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  let retryKeysRemoved = 0;
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
      if (count > 0) {
        removed += count;
        retryKeysRemoved += await deleteJobRetryKey(redis, raw);
      }
    } catch {
      /* skip */
    }
  }
  return { removed, retryKeysRemoved };
}

/**
 * Drain `move-events` jobs for watchlist-sim traders so queued moves cannot
 * recreate sim COPY positions after a copy reset. DTOs carry no `mode` — the
 * only safe sim discriminator is the trader's sim-enabled watchlist entry.
 */
async function removeMoveEventsForTraders(
  redis: Redis,
  queueName: string,
  traders: Set<string>,
): Promise<{ removed: number; moveIds: Set<string>; retryKeysRemoved: number }> {
  const items = await redis.lrange(queueName, 0, -1);
  let removed = 0;
  let retryKeysRemoved = 0;
  const moveIds = new Set<string>();
  for (const raw of items) {
    try {
      const job = JSON.parse(raw) as { id?: string; traderAddress?: string };
      if (!job.traderAddress || !traders.has(job.traderAddress.toLowerCase())) {
        continue;
      }
      if (job.id) moveIds.add(job.id);
      const count = await redis.lrem(queueName, 0, raw);
      if (count > 0) {
        removed += count;
        retryKeysRemoved += await deleteJobRetryKey(redis, raw);
      }
    } catch {
      /* skip */
    }
  }
  return { removed, moveIds, retryKeysRemoved };
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
  let deadLetterRemoved = 0;
  let jobRetryKeysRemoved = 0;

  const accumulateEntry = async (queueName: string): Promise<number> => {
    const result = await removeSimEntryJobsFromList(redis, queueName, algoKind);
    jobRetryKeysRemoved += result.retryKeysRemoved;
    return result.removed;
  };

  if (algoKind === 'crypto') {
    algoOrderSignalsRemoved =
      (await accumulateEntry(ALGO_QUEUE)) +
      (await accumulateEntry(processingKey(ALGO_QUEUE)));
  } else if (algoKind === 'weather') {
    algoOrderSignalsRemoved =
      (await accumulateEntry(WEATHER_QUEUE)) +
      (await accumulateEntry(processingKey(WEATHER_QUEUE)));
  } else if (algoKind === 'copy') {
    orderSignalsRemoved =
      (await accumulateEntry(COPY_QUEUE)) +
      (await accumulateEntry(processingKey(COPY_QUEUE)));
  }

  const positionIdSet = new Set(hints.copiedPositionIds);
  // Two passes: mitigate TOCTOU where BRPOPLPUSH moves a job from main →
  // :processing between the first main scan and the first processing scan.
  let closeSignalsRemoved = 0;
  const allCloseSignalIds = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
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
    closeSignalsRemoved += closeMain.removed + closeProcessing.removed;
    jobRetryKeysRemoved += closeMain.retryKeysRemoved + closeProcessing.retryKeysRemoved;
    for (const id of closeMain.closeSignalIds) allCloseSignalIds.add(id);
    for (const id of closeProcessing.closeSignalIds) allCloseSignalIds.add(id);
  }

  // Re-scan entry queues once more after the close passes (same TOCTOU window).
  if (algoKind === 'crypto') {
    algoOrderSignalsRemoved +=
      (await accumulateEntry(ALGO_QUEUE)) +
      (await accumulateEntry(processingKey(ALGO_QUEUE)));
  } else if (algoKind === 'weather') {
    algoOrderSignalsRemoved +=
      (await accumulateEntry(WEATHER_QUEUE)) +
      (await accumulateEntry(processingKey(WEATHER_QUEUE)));
  } else if (algoKind === 'copy') {
    orderSignalsRemoved +=
      (await accumulateEntry(COPY_QUEUE)) +
      (await accumulateEntry(processingKey(COPY_QUEUE)));
  }

  let executionResultsRemoved = 0;
  for (let pass = 0; pass < 2; pass++) {
    const resultsMain = await removeSimExecutionResultsFromList(
      redis,
      RESULTS_QUEUE,
      hints,
      allCloseSignalIds,
      algoKind,
    );
    const resultsProcessing = await removeSimExecutionResultsFromList(
      redis,
      processingKey(RESULTS_QUEUE),
      hints,
      allCloseSignalIds,
      algoKind,
    );
    executionResultsRemoved += resultsMain.removed + resultsProcessing.removed;
    jobRetryKeysRemoved +=
      resultsMain.retryKeysRemoved + resultsProcessing.retryKeysRemoved;
  }

  // Dead-letter lists use the same sim filters (do not wipe real-mode dead jobs).
  const entryDeadQueue =
    algoKind === 'weather'
      ? deadLetterQueueKey(WEATHER_QUEUE)
      : algoKind === 'copy'
        ? deadLetterQueueKey(COPY_QUEUE)
        : deadLetterQueueKey(ALGO_QUEUE);
  if (algoKind === 'crypto' || algoKind === 'weather') {
    const deadEntry = await accumulateEntry(entryDeadQueue);
    algoOrderSignalsRemoved += deadEntry;
    deadLetterRemoved += deadEntry;
  } else {
    const deadEntry = await accumulateEntry(entryDeadQueue);
    orderSignalsRemoved += deadEntry;
    deadLetterRemoved += deadEntry;
  }
  {
    const deadClose = await removeSimCloseJobsFromList(
      redis,
      deadLetterQueueKey(CLOSE_QUEUE),
      positionIdSet,
    );
    closeSignalsRemoved += deadClose.removed;
    deadLetterRemoved += deadClose.removed;
    jobRetryKeysRemoved += deadClose.retryKeysRemoved;
    for (const id of deadClose.closeSignalIds) allCloseSignalIds.add(id);
  }
  {
    const deadResults = await removeSimExecutionResultsFromList(
      redis,
      deadLetterQueueKey(RESULTS_QUEUE),
      hints,
      allCloseSignalIds,
      algoKind,
    );
    executionResultsRemoved += deadResults.removed;
    deadLetterRemoved += deadResults.removed;
    jobRetryKeysRemoved += deadResults.retryKeysRemoved;
  }

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
  // Close jobs removed by payload — also drop their signal-id markers if any.
  for (const closeSignalId of allCloseSignalIds) {
    markerKeysToDelete.push(...markerKeys(CLOSE_QUEUE, closeSignalId));
  }
  // Weather uses enqueueUnique with `weather-close:{posId}:{reason}`, not signal id.
  if (algoKind === 'weather') {
    for (const posId of hints.copiedPositionIds) {
      for (const reason of WEATHER_CLOSE_DEDUPE_REASONS) {
        markerKeysToDelete.push(
          ...markerKeys(CLOSE_QUEUE, `weather-close:${posId}:${reason}`),
        );
      }
    }
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

  // Prod keys = `algo-entry-cooldown:{conditionId}:sim` (see algo-entry-cooldown.ts).
  let cooldownKeysRemoved = 0;
  for (const conditionId of hints.conditionIds ?? []) {
    const key = algoEntryCooldownKey(conditionId, 'sim');
    if ((await redis.exists(key)) === 1) {
      cooldownKeysRemoved += await redis.del(key);
    }
  }

  let moveEventsRemoved = 0;
  if (algoKind === 'copy' && hints.simWatchlistTraders?.length) {
    const traders = new Set(hints.simWatchlistTraders.map((t) => t.toLowerCase()));
    const moveIds = new Set<string>();
    for (let pass = 0; pass < 2; pass++) {
      const moveMain = await removeMoveEventsForTraders(
        redis,
        MOVE_EVENTS_QUEUE,
        traders,
      );
      const moveProcessing = await removeMoveEventsForTraders(
        redis,
        processingKey(MOVE_EVENTS_QUEUE),
        traders,
      );
      moveEventsRemoved += moveMain.removed + moveProcessing.removed;
      jobRetryKeysRemoved += moveMain.retryKeysRemoved + moveProcessing.retryKeysRemoved;
      for (const id of moveMain.moveIds) moveIds.add(id);
      for (const id of moveProcessing.moveIds) moveIds.add(id);
    }
    const moveDead = await removeMoveEventsForTraders(
      redis,
      deadLetterQueueKey(MOVE_EVENTS_QUEUE),
      traders,
    );
    moveEventsRemoved += moveDead.removed;
    deadLetterRemoved += moveDead.removed;
    jobRetryKeysRemoved += moveDead.retryKeysRemoved;
    for (const id of moveDead.moveIds) moveIds.add(id);

    const moveDedupeKeys = [...moveIds].flatMap((id) =>
      markerKeys(MOVE_EVENTS_QUEUE, id),
    );
    if (moveDedupeKeys.length > 0) {
      const existing = await Promise.all(
        moveDedupeKeys.map(async (key) => ((await redis.exists(key)) === 1 ? key : null)),
      );
      const toDelete = existing.filter((k): k is string => k != null);
      if (toDelete.length > 0) {
        dedupeMarkersRemoved += toDelete.filter((k) => k.includes(':enqueued:')).length;
        retryMarkersRemoved += toDelete.length - toDelete.filter((k) => k.includes(':enqueued:')).length;
        await redis.del(...toDelete);
      }
    }
  }

  let weatherReentryKeysRemoved = 0;
  let weatherEntryCountKeysRemoved = 0;
  let weatherHysteresisKeysRemoved = 0;
  if (algoKind === 'weather') {
    const keysToDelete: string[] = [];
    for (const { city, dateIso } of hints.weatherCityDates ?? []) {
      keysToDelete.push(weatherReentryThrottleKey(city, dateIso, 'sim'));
      for (const strategyId of WEATHER_STRATEGY_IDS) {
        keysToDelete.push(weatherReentryCountKey(city, dateIso, strategyId, 'sim'));
      }
    }
    for (const id of hints.copiedPositionIds) {
      keysToDelete.push(weatherBucketHysteresisKey(id));
    }
    for (const key of keysToDelete) {
      const n = await redis.del(key);
      if (n > 0) {
        if (key.startsWith('weather-reentry:')) weatherReentryKeysRemoved += n;
        else if (key.startsWith('weather-entry-count:')) weatherEntryCountKeysRemoved += n;
        else weatherHysteresisKeysRemoved += n;
      }
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
    moveEventsRemoved,
    weatherReentryKeysRemoved,
    weatherEntryCountKeysRemoved,
    weatherHysteresisKeysRemoved,
    deadLetterRemoved,
    jobRetryKeysRemoved,
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
