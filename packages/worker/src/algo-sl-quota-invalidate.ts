import type { Redis } from 'ioredis';
import {
  publishAlgoSlQuotaInvalidate,
  shouldInvalidateAlgoSlQuotaOnClose,
  type CopiedPosition,
  type TradingMode,
} from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'algo-sl-quota-invalidate' });

let redisPub: Redis | null = null;

export function configureAlgoSlQuotaInvalidatePublisher(redis: Redis): void {
  redisPub = redis;
}

export function notifyAlgoSlQuotaInvalidate(
  conditionId: string,
  mode?: TradingMode,
): void {
  if (!redisPub || !conditionId) return;
  void publishAlgoSlQuotaInvalidate(redisPub, conditionId, mode).catch((err) => {
    log.warn({ err, conditionId, mode }, 'failed to publish algo SL quota invalidate');
  });
}

export function notifyAlgoSlQuotaInvalidateFromClose(
  pos: CopiedPosition,
  exitReason?: string | null,
): void {
  if (!shouldInvalidateAlgoSlQuotaOnClose(pos, exitReason)) return;
  // CopiedPosition.mode is a plain string column; narrow it to TradingMode.
  const mode: TradingMode | undefined =
    pos.mode === 'sim' || pos.mode === 'real' ? pos.mode : undefined;
  notifyAlgoSlQuotaInvalidate(pos.conditionId, mode);
}
