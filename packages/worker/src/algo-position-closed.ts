import type { Redis } from 'ioredis';
import {
  publishAlgoPositionClosed,
  shouldPublishAlgoPositionClosed,
  type CopiedPosition,
} from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'algo-position-closed' });

let redisPub: Redis | null = null;

export function configureAlgoPositionClosedPublisher(redis: Redis): void {
  redisPub = redis;
}

export function notifyAlgoPositionClosed(pos: CopiedPosition): void {
  if (!shouldPublishAlgoPositionClosed(pos)) return;
  if (!redisPub) return;

  void publishAlgoPositionClosed(redisPub, {
    positionId: pos.id,
    conditionId: pos.conditionId,
  }).catch((err) => {
    log.warn(
      { err, positionId: pos.id, conditionId: pos.conditionId },
      'failed to publish algo-position-closed',
    );
  });
}
