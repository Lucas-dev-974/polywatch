import type { EntityManager } from 'typeorm';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';
import type { WatchlistEntry } from '../entities/Watchlist.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { ExitAttemptEventDto } from '../services/exit-attempt-event.service.js';

export const SNAPSHOT_DECISION_MAX_EVENTS = 500;
export const SNAPSHOT_DECISION_MAX_JSON_BYTES = 2_000_000;

export interface SimSnapshotMoveEvent {
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

export interface SimSnapshotDecisionSummary {
  exitAttemptsTotal: number;
  exitAttemptsByKind: Record<string, number>;
  exitAttemptsByCloseReason: Record<string, number>;
  moveEventsTotal: number;
  moveEventsByType: Record<string, number>;
  moveEventsSkippedSim: number;
  windowFrom: string;
  snapshotAt: string;
  truncated: boolean;
  openPositionCount: number;
  closedPositionCount: number;
  otherPositionCount: number;
  positionsByStatus: Record<string, number>;
}

export interface SimSnapshotDecisionPayload {
  exitAttempts: ExitAttemptEventDto[];
  moveEvents: SimSnapshotMoveEvent[];
  summary: SimSnapshotDecisionSummary;
}

function toExitAttemptDto(row: ExitAttemptEvent): ExitAttemptEventDto {
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

function toMoveEventDto(row: MoveEventEntity): SimSnapshotMoveEvent {
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

function incrementCount(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function buildPositionBreakdown(positions: CopiedPosition[]): {
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

export async function resolveDecisionWindowFrom(
  manager: EntityManager,
  snapshotAt: Date,
  windowHours: number,
): Promise<Date> {
  const hourFloor = new Date(snapshotAt.getTime() - windowHours * 3_600_000);

  const lastSnap = await manager
    .getRepository(SimulationStateSnapshot)
    .createQueryBuilder('s')
    .orderBy('s.createdAt', 'DESC')
    .addOrderBy('s.id', 'DESC')
    .select(['s.createdAt'])
    .getOne();

  const balance = await manager
    .getRepository(SimulationBalance)
    .findOne({ where: {}, select: ['sessionStartedAt'] });

  const candidates = [hourFloor.getTime()];
  if (lastSnap?.createdAt) {
    candidates.push(lastSnap.createdAt.getTime());
  }
  if (balance?.sessionStartedAt) {
    candidates.push(balance.sessionStartedAt.getTime());
  }

  return new Date(Math.max(...candidates));
}

function truncateEvents<T>(items: T[], max: number): { items: T[]; truncated: boolean } {
  if (items.length <= max) {
    return { items, truncated: false };
  }
  return { items: items.slice(items.length - max), truncated: true };
}

export async function collectSimDecisionPayload(
  manager: EntityManager,
  options: {
    snapshotAt: Date;
    windowHours: number;
    positions: CopiedPosition[];
    watchlistEntries: WatchlistEntry[];
  },
): Promise<SimSnapshotDecisionPayload> {
  const windowFrom = await resolveDecisionWindowFrom(
    manager,
    options.snapshotAt,
    options.windowHours,
  );

  const exitRows = await manager
    .getRepository(ExitAttemptEvent)
    .createQueryBuilder('e')
    .where('e.mode = :mode', { mode: 'sim' })
    .andWhere('e.createdAt >= :windowFrom', { windowFrom })
    .andWhere('e.createdAt <= :snapshotAt', { snapshotAt: options.snapshotAt })
    .orderBy('e.createdAt', 'ASC')
    .addOrderBy('e.id', 'ASC')
    .getMany();

  const simTraderAddresses = [
    ...new Set(
      options.watchlistEntries
        .filter((w) => w.simEnabled !== false)
        .map((w) => w.traderAddress.toLowerCase()),
    ),
  ];

  let moveRows: MoveEventEntity[] = [];
  if (simTraderAddresses.length > 0) {
    moveRows = await manager
      .getRepository(MoveEventEntity)
      .createQueryBuilder('m')
      .where('LOWER(m.traderAddress) IN (:...addrs)', {
        addrs: simTraderAddresses,
      })
      .andWhere('m.detectedAt >= :windowFrom', { windowFrom })
      .andWhere('m.detectedAt <= :snapshotAt', { snapshotAt: options.snapshotAt })
      .orderBy('m.detectedAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getMany();
  }

  const exitTrunc = truncateEvents(exitRows, SNAPSHOT_DECISION_MAX_EVENTS);
  const moveTrunc = truncateEvents(moveRows, SNAPSHOT_DECISION_MAX_EVENTS);

  const exitAttemptsByKind: Record<string, number> = {};
  const exitAttemptsByCloseReason: Record<string, number> = {};
  for (const row of exitRows) {
    incrementCount(exitAttemptsByKind, row.kind);
    incrementCount(exitAttemptsByCloseReason, row.closeReason);
  }

  const moveEventsByType: Record<string, number> = {};
  let moveEventsSkippedSim = 0;
  for (const row of moveRows) {
    incrementCount(moveEventsByType, row.eventType);
    if (row.skipReasons?.sim) {
      moveEventsSkippedSim += 1;
    }
  }

  const positionBreakdown = buildPositionBreakdown(options.positions);

  return {
    exitAttempts: exitTrunc.items.map(toExitAttemptDto),
    moveEvents: moveTrunc.items.map(toMoveEventDto),
    summary: {
      exitAttemptsTotal: exitRows.length,
      exitAttemptsByKind,
      exitAttemptsByCloseReason,
      moveEventsTotal: moveRows.length,
      moveEventsByType,
      moveEventsSkippedSim,
      windowFrom: windowFrom.toISOString(),
      snapshotAt: options.snapshotAt.toISOString(),
      truncated: exitTrunc.truncated || moveTrunc.truncated,
      ...positionBreakdown,
    },
  };
}

export function estimateDecisionPayloadBytes(payload: SimSnapshotDecisionPayload): number {
  return Buffer.byteLength(
    JSON.stringify({
      exitAttempts: payload.exitAttempts,
      moveEvents: payload.moveEvents,
      summary: payload.summary,
    }),
    'utf8',
  );
}
