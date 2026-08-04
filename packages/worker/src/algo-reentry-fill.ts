import type { Redis } from 'ioredis';
import {
  CryptoConfigService,
  publishAlgoReentryFill,
  recordCryptoReentryFill,
  resolveCryptoAlgoReentryParams,
  shouldPublishAlgoReentryFill,
  type CopiedPosition,
  type Execution,
  type ExecutionResult,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import pino from 'pino';

const log = pino({ name: 'algo-reentry-fill' });

let redisPub: Redis | null = null;
let dsRef: DataSource | null = null;

export function configureAlgoReentryFillPublisher(
  redis: Redis,
  ds?: DataSource,
): void {
  redisPub = redis;
  if (ds) dsRef = ds;
}

export function notifyAlgoReentryFillFromOpen(
  pos: CopiedPosition,
  execution: Execution,
  result: ExecutionResult,
): void {
  if (!shouldPublishAlgoReentryFill(pos, execution, result)) return;
  if (!redisPub) return;

  const redis = redisPub;
  const filledAtMs = result.executedAt.getTime();

  void (async () => {
    let windowMs: number | undefined;
    try {
      if (dsRef) {
        const cryptoConfig = await new CryptoConfigService(dsRef).getConfig();
        // Interval override lives on selections; worker fill path uses the
        // config/default window (same fallback as resolveCryptoAlgoReentryParams).
        windowMs = resolveCryptoAlgoReentryParams(cryptoConfig, null).windowMs;
      }
    } catch (err) {
      log.warn(
        { err, conditionId: pos.conditionId },
        'failed to resolve re-entry window for Redis write',
      );
    }

    if (windowMs != null && windowMs > 0) {
      try {
        const recorded = await recordCryptoReentryFill(redis, {
          conditionId: pos.conditionId,
          outcome: pos.outcome,
          positionId: pos.id,
          windowMs,
          nowMs: filledAtMs,
        });
        log.info(
          {
            conditionId: pos.conditionId,
            outcome: pos.outcome,
            positionId: pos.id,
            recorded: recorded.recorded,
            count: recorded.state.count,
          },
          'crypto re-entry Redis slot updated after fill',
        );
      } catch (err) {
        log.warn(
          { err, conditionId: pos.conditionId, positionId: pos.id },
          'failed to persist crypto re-entry throttle in Redis',
        );
      }
    }

    try {
      await publishAlgoReentryFill(redis, {
        conditionId: pos.conditionId,
        outcome: pos.outcome,
        filledAtMs,
        positionId: pos.id,
        windowMs,
      });
    } catch (err) {
      log.warn(
        { err, conditionId: pos.conditionId, outcome: pos.outcome },
        'failed to publish algo re-entry fill',
      );
    }
  })();
}
