import type { EntityManager } from 'typeorm';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { RealSessionState } from '../entities/RealSessionState.js';
import { RealStateSnapshot } from '../entities/RealStateSnapshot.js';
import type { WatchlistEntry } from '../entities/Watchlist.js';
import type { ExitAttemptEventDto } from '../services/exit-attempt-event.service.js';
import {
  SNAPSHOT_DECISION_MAX_EVENTS,
  SNAPSHOT_DECISION_MAX_JSON_BYTES,
  buildPositionBreakdown,
  estimateDecisionPayloadJsonBytes,
  incrementCount,
  toExitAttemptDto,
  toMoveEventDto,
  truncateEvents,
  type SnapshotMoveEvent,
} from '../snapshot/decision-collector-shared.js';

export {
  SNAPSHOT_DECISION_MAX_EVENTS,
  SNAPSHOT_DECISION_MAX_JSON_BYTES,
} from '../snapshot/decision-collector-shared.js';

export type RealSnapshotMoveEvent = SnapshotMoveEvent;

export interface RealSnapshotDecisionSummary {
  exitAttemptsTotal: number;
  exitAttemptsByKind: Record<string, number>;
  exitAttemptsByCloseReason: Record<string, number>;
  moveEventsTotal: number;
  moveEventsByType: Record<string, number>;
  moveEventsSkippedReal: number;
  windowFrom: string;
  snapshotAt: string;
  truncated: boolean;
  openPositionCount: number;
  closedPositionCount: number;
  otherPositionCount: number;
  positionsByStatus: Record<string, number>;
}

export interface RealSnapshotDecisionPayload {
  exitAttempts: ExitAttemptEventDto[];
  moveEvents: RealSnapshotMoveEvent[];
  summary: RealSnapshotDecisionSummary;
}

export async function resolveRealDecisionWindowFrom(
  manager: EntityManager,
  snapshotAt: Date,
  windowHours: number,
): Promise<Date> {
  const hourFloor = new Date(snapshotAt.getTime() - windowHours * 3_600_000);

  const lastSnap = await manager
    .getRepository(RealStateSnapshot)
    .createQueryBuilder('s')
    .orderBy('s.createdAt', 'DESC')
    .addOrderBy('s.id', 'DESC')
    .select(['s.createdAt'])
    .getOne();

  const state = await manager
    .getRepository(RealSessionState)
    .findOne({ where: { id: 1 }, select: ['periodStartedAt'] });

  const candidates = [hourFloor.getTime()];
  if (lastSnap?.createdAt) {
    candidates.push(lastSnap.createdAt.getTime());
  }
  if (state?.periodStartedAt) {
    candidates.push(state.periodStartedAt.getTime());
  }

  return new Date(Math.max(...candidates));
}

export async function collectRealDecisionPayload(
  manager: EntityManager,
  options: {
    snapshotAt: Date;
    windowHours: number;
    positions: CopiedPosition[];
    watchlistEntries: WatchlistEntry[];
  },
): Promise<RealSnapshotDecisionPayload> {
  const windowFrom = await resolveRealDecisionWindowFrom(
    manager,
    options.snapshotAt,
    options.windowHours,
  );

  const exitRows = await manager
    .getRepository(ExitAttemptEvent)
    .createQueryBuilder('e')
    .where('e.mode = :mode', { mode: 'real' })
    .andWhere('e.createdAt >= :windowFrom', { windowFrom })
    .andWhere('e.createdAt <= :snapshotAt', { snapshotAt: options.snapshotAt })
    .orderBy('e.createdAt', 'ASC')
    .addOrderBy('e.id', 'ASC')
    .getMany();

  const realTraderAddresses = [
    ...new Set(
      options.watchlistEntries
        .filter((w) => w.realEnabled !== false)
        .map((w) => w.traderAddress.toLowerCase()),
    ),
  ];

  let moveRows: MoveEventEntity[] = [];
  if (realTraderAddresses.length > 0) {
    moveRows = await manager
      .getRepository(MoveEventEntity)
      .createQueryBuilder('m')
      .where('LOWER(m.traderAddress) IN (:...addrs)', {
        addrs: realTraderAddresses,
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
  let moveEventsSkippedReal = 0;
  for (const row of moveRows) {
    incrementCount(moveEventsByType, row.eventType);
    if (row.skipReasons?.real) {
      moveEventsSkippedReal += 1;
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
      moveEventsSkippedReal,
      windowFrom: windowFrom.toISOString(),
      snapshotAt: options.snapshotAt.toISOString(),
      truncated: exitTrunc.truncated || moveTrunc.truncated,
      ...positionBreakdown,
    },
  };
}

export function estimateRealDecisionPayloadBytes(
  payload: RealSnapshotDecisionPayload,
): number {
  return estimateDecisionPayloadJsonBytes(payload);
}
