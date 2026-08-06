/**
 * Shared pure helpers for sim/real snapshot decision collectors.
 *
 * Convention: any fix to sim or real collector logic that touches shared behavior
 * must update this module (or both collectors) and mention the mirror in the commit:
 *   fix(sim): ... [mirror: real/snapshot-decision-collector.ts]
 *   fix(real): ... [mirror: simulation/snapshot-decision-collector.ts]
 */
import type { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import type { MoveEventEntity } from '../entities/MoveEvent.js';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { ExitAttemptEventDto } from '../services/exit-attempt-event.service.js';

export const SNAPSHOT_DECISION_MAX_EVENTS = 500;
export const SNAPSHOT_DECISION_MAX_JSON_BYTES = 2_000_000;

export interface SnapshotMoveEvent {
  id: string;
  traderAddress: string;
  conditionId: string;
  assetId: string;
  outcome: string | null;
  eventType: string;
  previousTraderSize: number;
  traderSize: number;
  traderAvgPrice: number | null;
  snapshotSeq: number;
  processed: boolean;
  detectedAt: string;
  skipReasonsSim: string | null;
  skipReasonsReal: string | null;
}

export function toExitAttemptDto(row: ExitAttemptEvent): ExitAttemptEventDto {
  return {
    id: row.id,
    copiedPositionId: row.copiedPositionId,
    kind: row.kind,
    closeReason: row.closeReason,
    blockReason: row.blockReason,
    error: row.error,
    executionId: row.executionId,
    markBid: row.markBid,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

export function toMoveEventDto(row: MoveEventEntity): SnapshotMoveEvent {
  return {
    id: row.id,
    traderAddress: row.traderAddress,
    conditionId: row.conditionId,
    assetId: row.assetId,
    outcome: row.outcome,
    eventType: row.eventType,
    previousTraderSize: row.previousTraderSize,
    traderSize: row.traderSize,
    traderAvgPrice: row.traderAvgPrice,
    snapshotSeq: row.snapshotSeq,
    processed: row.processed,
    detectedAt:
      row.detectedAt instanceof Date
        ? row.detectedAt.toISOString()
        : String(row.detectedAt),
    skipReasonsSim: row.skipReasons?.sim ?? null,
    skipReasonsReal: row.skipReasons?.real ?? null,
  };
}

export function incrementCount(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function buildPositionBreakdown(positions: CopiedPosition[]): {
  openPositionCount: number;
  closedPositionCount: number;
  otherPositionCount: number;
  positionsByStatus: Record<string, number>;
} {
  let openPositionCount = 0;
  let closedPositionCount = 0;
  const positionsByStatus: Record<string, number> = {};

  for (const pos of positions) {
    incrementCount(positionsByStatus, pos.status);
    if (isOpenLikePositionStatus(pos.status)) {
      openPositionCount += 1;
    } else if (pos.status === 'closed') {
      closedPositionCount += 1;
    }
  }

  return {
    openPositionCount,
    closedPositionCount,
    otherPositionCount: positions.length - openPositionCount - closedPositionCount,
    positionsByStatus,
  };
}

export function truncateEvents<T>(
  items: T[],
  max: number,
): { items: T[]; truncated: boolean } {
  if (items.length <= max) {
    return { items, truncated: false };
  }
  return { items: items.slice(items.length - max), truncated: true };
}

export function estimateDecisionPayloadJsonBytes(payload: {
  exitAttempts: unknown;
  moveEvents: unknown;
  summary: unknown;
}): number {
  return Buffer.byteLength(
    JSON.stringify({
      exitAttempts: payload.exitAttempts,
      moveEvents: payload.moveEvents,
      summary: payload.summary,
    }),
    'utf8',
  );
}

type DecisionPayloadByteBudget = {
  exitAttempts: unknown[];
  moveEvents: unknown[];
  summary: { truncated?: boolean };
};

/**
 * Second-pass archive byte budget: if the JSON payload exceeds
 * {@link SNAPSHOT_DECISION_MAX_JSON_BYTES}, keep the newest half of each
 * event array and mark `summary.truncated`.
 */
export function applyDecisionPayloadByteBudget<T extends DecisionPayloadByteBudget>(
  payload: T,
): T {
  if (
    estimateDecisionPayloadJsonBytes(payload) <= SNAPSHOT_DECISION_MAX_JSON_BYTES
  ) {
    return payload;
  }
  payload.summary.truncated = true;
  const half = Math.floor(SNAPSHOT_DECISION_MAX_EVENTS / 2);
  payload.exitAttempts = payload.exitAttempts.slice(-half);
  payload.moveEvents = payload.moveEvents.slice(-half);
  return payload;
}
