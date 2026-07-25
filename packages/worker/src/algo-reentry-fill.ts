import type { Redis } from 'ioredis';
import {
  publishAlgoReentryFill,
  shouldPublishAlgoReentryFill,
  type CopiedPosition,
  type Execution,
  type ExecutionResult,
} from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'algo-reentry-fill' });

let redisPub: Redis | null = null;

export function configureAlgoReentryFillPublisher(redis: Redis): void {
  redisPub = redis;
}

export function notifyAlgoReentryFillFromOpen(
  pos: CopiedPosition,
  execution: Execution,
  result: ExecutionResult,
): void {
  if (!shouldPublishAlgoReentryFill(pos, execution, result)) return;
  if (!redisPub) return;

  void publishAlgoReentryFill(redisPub, {
    conditionId: pos.conditionId,
    outcome: pos.outcome,
    filledAtMs: result.executedAt.getTime(),
  }).catch((err) => {
    log.warn(
      { err, conditionId: pos.conditionId, outcome: pos.outcome },
      'failed to publish algo re-entry fill',
    );
  });
}
