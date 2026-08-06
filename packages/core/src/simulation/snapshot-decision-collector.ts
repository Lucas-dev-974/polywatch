import type { EntityManager } from 'typeorm';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { SimulationStateSnapshot } from '../entities/SimulationStateSnapshot.js';
import type { WatchlistEntry } from '../entities/Watchlist.js';
import type { SimAlgoKind } from './algo-kind.js';
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

export type SimSnapshotMoveEvent = SnapshotMoveEvent;

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

export async function resolveDecisionWindowFrom(
  manager: EntityManager,
  snapshotAt: Date,
  windowHours: number,
  algoKind: SimAlgoKind,
): Promise<Date> {
  const hourFloor = new Date(snapshotAt.getTime() - windowHours * 3_600_000);

  const lastSnap = await manager
    .getRepository(SimulationStateSnapshot)
    .createQueryBuilder('s')
    .where('s.algoKind = :algoKind', { algoKind })
    .orderBy('s.createdAt', 'DESC')
    .addOrderBy('s.id', 'DESC')
    .select(['s.createdAt'])
    .getOne();

  const balance = await manager.getRepository(SimulationBalance).findOne({
    where: { algoKind },
    select: ['sessionStartedAt'],
  });

  const candidates = [hourFloor.getTime()];
  if (lastSnap?.createdAt) {
    candidates.push(lastSnap.createdAt.getTime());
  }
  if (balance?.sessionStartedAt) {
    candidates.push(balance.sessionStartedAt.getTime());
  }

  return new Date(Math.max(...candidates));
}

export async function collectSimDecisionPayload(
  manager: EntityManager,
  options: {
    algoKind: SimAlgoKind;
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
    options.algoKind,
  );

  const positionIds = options.positions.map((p) => p.id);
  let exitRows: ExitAttemptEvent[] = [];
  if (positionIds.length > 0) {
    exitRows = await manager
      .getRepository(ExitAttemptEvent)
      .createQueryBuilder('e')
      .where('e.mode = :mode', { mode: 'sim' })
      .andWhere('e.createdAt >= :windowFrom', { windowFrom })
      .andWhere('e.createdAt <= :snapshotAt', { snapshotAt: options.snapshotAt })
      .andWhere('e.copiedPositionId IN (:...positionIds)', { positionIds })
      .orderBy('e.createdAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .getMany();
  }

  const simTraderAddresses =
    options.algoKind === 'copy'
      ? [
          ...new Set(
            options.watchlistEntries
              .filter((w) => w.simEnabled !== false)
              .map((w) => w.traderAddress.toLowerCase()),
          ),
        ]
      : [];

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
  return estimateDecisionPayloadJsonBytes(payload);
}
