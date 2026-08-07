import type { Redis } from 'ioredis';
import {
  CRYPTO_ALGO_RUNTIME_STATUS_KEY,
  type CryptoAlgoRuntimeStatusPayload,
} from '@polywatch/core';

const RUNTIME_STATUS_TTL_SEC = 120;

export type CryptoAlgoRuntimeStatus = CryptoAlgoRuntimeStatusPayload;
export { CRYPTO_ALGO_RUNTIME_STATUS_KEY };

/** Publishes live runner diagnostics to Redis for the backend /status endpoint. */
export class CryptoAlgoRuntimeStatusPublisher {
  private pending: Partial<CryptoAlgoRuntimeStatus> = {};

  constructor(private readonly redis: Redis) {}

  recordSkip(reason: string, conditionId?: string): void {
    const detail = conditionId ? `${reason} (${conditionId})` : reason;
    this.pending.lastSkipReason = detail;
    this.pending.lastSkipAt = new Date().toISOString();
  }

  async publish(partial: Partial<CryptoAlgoRuntimeStatus>): Promise<void> {
    const payload: CryptoAlgoRuntimeStatus = {
      enabledSelections: partial.enabledSelections ?? this.pending.enabledSelections ?? 0,
      evaluableSelections: partial.evaluableSelections ?? this.pending.evaluableSelections ?? 0,
      wsConnected: partial.wsConnected ?? this.pending.wsConnected ?? false,
      lastEvaluatedAt: partial.lastEvaluatedAt ?? new Date().toISOString(),
      lastSkipReason: partial.lastSkipReason ?? this.pending.lastSkipReason ?? null,
      lastSkipAt: partial.lastSkipAt ?? this.pending.lastSkipAt ?? null,
      entriesLastCycle: partial.entriesLastCycle ?? this.pending.entriesLastCycle ?? 0,
      evaluatedLastCycle: partial.evaluatedLastCycle ?? this.pending.evaluatedLastCycle ?? 0,
    };

    await this.redis.set(
      CRYPTO_ALGO_RUNTIME_STATUS_KEY,
      JSON.stringify(payload),
      'EX',
      RUNTIME_STATUS_TTL_SEC,
    );

    this.pending = {
      lastSkipReason: payload.lastSkipReason,
      lastSkipAt: payload.lastSkipAt,
    };
  }
}
