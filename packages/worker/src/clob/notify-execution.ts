import pino from 'pino';
import { postBackendJson } from '../backend-client.js';
import { CircuitBreaker } from '../polymarket/circuit-breaker.js';
import type { ExecutionResult } from '@polywatch/core';
import type { FinalizeInput } from '@polywatch/core';

const log = pino({ name: 'notify-execution' });

const breaker = new CircuitBreaker({
  name: 'backend-execution-notify',
  failureThreshold: 5,
  cooldownMs: 30_000,
});

export interface ExecutionNotifyPayload {
  orderSignalId: string;
  status: string;
  fillPrice: number;
  fillQuantity: number;
  fees: number;
  txHash?: string;
  clobOrderId?: string;
  error?: string;
}

export function buildExecutionNotifyPayload(
  source: ExecutionResult | FinalizeInput,
): ExecutionNotifyPayload {
  return {
    orderSignalId: source.orderSignalId,
    status: source.status,
    fillPrice: source.fillPrice,
    fillQuantity: source.fillQuantity,
    fees: source.fees,
    txHash: source.txHash,
    clobOrderId: source.clobOrderId,
    error: source.error,
  };
}

export async function notifyBackendExecution(
  payload: ExecutionNotifyPayload,
): Promise<void> {
  try {
    await breaker.call(() => postBackendJson('/api/executions', payload));
  } catch (err) {
    log.warn({ err }, 'failed to notify backend execution');
  }
}
