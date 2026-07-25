import type { ExecutionResult, OrderSignal } from '@polywatch/core';

type FailedSignal = Pick<OrderSignal, 'id' | 'mode'> &
  Partial<Pick<OrderSignal, 'reason' | 'closeRetryAttempt'>>;

export function failedExecution(
  signal: FailedSignal,
  error: string,
  options?: { slippagePercent?: number; referenceVwap?: number },
): ExecutionResult {
  return {
    orderSignalId: signal.id,
    mode: signal.mode,
    status: 'failed',
    fillPrice: 0,
    fillQuantity: 0,
    fees: 0,
    error,
    reason: signal.reason,
    closeRetryAttempt: signal.closeRetryAttempt,
    executedAt: new Date(),
    ...(options?.referenceVwap != null ? { referenceVwap: options.referenceVwap } : {}),
    ...(options?.slippagePercent != null ? { slippagePercent: options.slippagePercent } : {}),
  };
}
