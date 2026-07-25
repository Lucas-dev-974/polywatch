import { createHash } from 'node:crypto';
import type { MoveEventType, OrderReason, TradingMode } from '../types/index.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Fixed-precision serialization for sizes used in idempotence hashes.
 * Template-literal `${number}` is not stable across float artifacts
 * (e.g. 0.1 + 0.2 → "0.30000000000000004"), which would split one logical
 * move into two distinct hashes. Polymarket sizes use 6 decimals max.
 */
function normalizeSize(size: number): string {
  return size.toFixed(6);
}

export function hashMoveEventId(params: {
  traderAddress: string;
  conditionId: string;
  assetId: string;
  type: MoveEventType;
  previousTraderSize: number;
  traderSize: number;
  snapshotSeq: number;
}): string {
  const {
    traderAddress,
    conditionId,
    assetId,
    type,
    previousTraderSize,
    traderSize,
    snapshotSeq,
  } = params;
  return sha256(
    `${traderAddress}::${conditionId}::${assetId}::${type}::${normalizeSize(previousTraderSize)}::${normalizeSize(traderSize)}::${snapshotSeq}`,
  );
}

export function hashCopyOrderSignalId(params: {
  moveEventId: string;
  mode: TradingMode;
  reason: OrderReason;
  side: 'BUY' | 'SELL';
}): string {
  const { moveEventId, mode, reason, side } = params;
  return sha256(`${moveEventId}::${mode}::${reason}::${side}`);
}

export function hashStrategyOrderSignalId(params: {
  copiedPositionId: number;
  mode: TradingMode;
  reason: OrderReason;
  closingAttemptSeq: number;
  closeRetryAttempt?: number;
}): string {
  const { copiedPositionId, mode, reason, closingAttemptSeq, closeRetryAttempt } =
    params;
  const retrySuffix =
    closeRetryAttempt != null && closeRetryAttempt > 0
      ? `::${closeRetryAttempt}`
      : '';
  return sha256(
    `${copiedPositionId}::${mode}::${reason}::${closingAttemptSeq}${retrySuffix}`,
  );
}

export function hashRedemptionOrderSignalId(copiedPositionId: number): string {
  return sha256(`${copiedPositionId}::REDEMPTION`);
}

export type AlgoSignalKeyParams = {
  conditionId: string;
  interval: string;
  outcome: string;
  strategyId: string;
  mode: TradingMode;
};

/**
 * Market-level key for enqueue deduplication while a reservation is active.
 * The strategy re-emits the same logical signal on every tick.
 */
export function hashAlgoLogicalKey(params: AlgoSignalKeyParams): string {
  const { conditionId, interval, outcome, strategyId, mode } = params;
  return sha256(
    `${conditionId}::${interval}::${outcome}::${strategyId}::${mode}`,
  );
}

/** Per-position execution idempotence key (one execution row per position attempt). */
export function hashAlgoOrderSignalId(
  params: AlgoSignalKeyParams & { copiedPositionId: number },
): string {
  const logical = hashAlgoLogicalKey(params);
  return sha256(`${logical}::${params.copiedPositionId}`);
}
