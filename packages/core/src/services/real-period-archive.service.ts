import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { MarketPositionTick } from '../entities/MarketPositionTick.js';
import type { RealSession } from '../entities/RealSession.js';
import { RealSession as RealSessionEntity } from '../entities/RealSession.js';
import { RealArchivePosition } from '../entities/RealArchivePosition.js';
import { RealArchiveExecution } from '../entities/RealArchiveExecution.js';
import { RealArchiveExitAttempt } from '../entities/RealArchiveExitAttempt.js';
import type {
  RealArchiveExecutionDto,
  RealArchiveExitAttemptDto,
  RealArchiveListOptions,
  RealArchiveListResult,
  RealArchivePositionDto,
  RealArchiveSummary,
  RealArchiveType,
} from '../types/real-session-archive.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ARCHIVE_INSERT_CHUNK_SIZE = 150;

async function insertInChunks(
  manager: EntityManager,
  entity: Parameters<EntityManager['insert']>[0],
  rows: Record<string, unknown>[],
  chunkSize = ARCHIVE_INSERT_CHUNK_SIZE,
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await manager.insert(entity, rows.slice(i, i + chunkSize) as never);
  }
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function parseSummary(json: string | null): RealArchiveSummary | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as RealArchiveSummary;
  } catch {
    return null;
  }
}

export interface ArchiveClosedInWindowResult {
  archivedPositionIds: number[];
  summary: RealArchiveSummary;
}

export class RealPeriodArchiveService {
  constructor(private readonly ds: DataSource) {}

  /**
   * Archive closed real positions whose closed_at falls in [startedAt, rotateAt).
   */
  async archiveClosedInWindow(
    manager: EntityManager,
    session: RealSession,
    rotateAt: Date,
  ): Promise<ArchiveClosedInWindowResult> {
    const sessionId = session.id;
    const startedAt = session.startedAt;

    const closedPositions = await manager
      .getRepository(CopiedPosition)
      .createQueryBuilder('cp')
      .where('cp.mode = :mode', { mode: 'real' })
      .andWhere("cp.status = 'closed'")
      .andWhere('cp.closed_at >= :startedAt', { startedAt })
      .andWhere('cp.closed_at < :rotateAt', { rotateAt })
      .orderBy('cp.id', 'ASC')
      .getMany();

    const archivedPositionIds = closedPositions.map((cp) => cp.id);

    if (closedPositions.length > 0) {
      await insertInChunks(
        manager,
        RealArchivePosition,
        closedPositions.map((cp) => ({
          sessionId,
          sourceId: cp.id,
          conditionId: cp.conditionId,
          assetId: cp.assetId,
          marketTitle: null,
          outcome: cp.outcome,
          side: cp.side,
          size: cp.quantity,
          entryPrice: cp.entryPrice,
          exitPrice: null,
          realizedPnl: cp.realizedPnl,
          closeReason: cp.closeReason,
          reason: cp.reason,
          openedAt: cp.openedAt,
          closedAt: cp.closedAt,
          rawJson: JSON.stringify(cp),
        })),
      );
    }

    let executionCount = 0;
    if (archivedPositionIds.length > 0) {
      const executions = await manager.getRepository(Execution).find({
        where: { mode: 'real', copiedPositionId: In(archivedPositionIds) },
        order: { id: 'ASC' },
      });
      executionCount = executions.length;
      if (executions.length > 0) {
        await insertInChunks(
          manager,
          RealArchiveExecution,
          executions.map((e) => ({
            sessionId,
            sourceId: e.id,
            copiedPositionId: e.copiedPositionId,
            side: e.side,
            fillPrice: e.fillPrice,
            fillQuantity: e.fillQuantity,
            fees: e.fees,
            realizedPnl: e.realizedPnl,
            status: e.status,
            reason: e.reason,
            executedAt: e.executedAt,
            rawJson: JSON.stringify(e),
          })),
        );
      }
    }

    let exitAttemptCount = 0;
    if (archivedPositionIds.length > 0) {
      const exitAttemptRows = await manager
        .getRepository(ExitAttemptEvent)
        .createQueryBuilder('ea')
        .where('ea.mode = :mode', { mode: 'real' })
        .andWhere('ea.copied_position_id IN (:...ids)', {
          ids: archivedPositionIds,
        })
        .orderBy('ea.id', 'ASC')
        .getMany();
      exitAttemptCount = exitAttemptRows.length;
      if (exitAttemptRows.length > 0) {
        await insertInChunks(
          manager,
          RealArchiveExitAttempt,
          exitAttemptRows.map((ea) => ({
            sessionId,
            sourceId: ea.id,
            copiedPositionId: ea.copiedPositionId,
            kind: ea.kind,
            closeReason: ea.closeReason,
            blockReason: ea.blockReason,
            error: ea.error,
            markBid: ea.markBid,
            createdAt: ea.createdAt,
            rawJson: JSON.stringify(ea),
          })),
        );
      }
    }

    const summary: RealArchiveSummary = {
      positions: closedPositions.length,
      executions: executionCount,
      exitAttempts: exitAttemptCount,
      periodFrom: toIso(startedAt),
      periodTo: toIso(rotateAt),
    };

    await manager.getRepository(RealSessionEntity).update(sessionId, {
      archiveSummaryJson: JSON.stringify(summary),
    });

    return { archivedPositionIds, summary };
  }

  /**
   * Delete live rows for archived position IDs only (never open-like positions).
   */
  async clearArchivedLive(
    manager: EntityManager,
    archivedPositionIds: number[],
  ): Promise<void> {
    if (archivedPositionIds.length === 0) return;

    await manager.query(
      `
      DELETE FROM market_position_ticks
      WHERE copied_position_id = ANY($1::int[])
      `,
      [archivedPositionIds],
    );

    await manager
      .getRepository(ExitAttemptEvent)
      .createQueryBuilder()
      .delete()
      .where('mode = :mode', { mode: 'real' })
      .andWhere('copied_position_id IN (:...ids)', { ids: archivedPositionIds })
      .execute();

    await manager
      .getRepository(Execution)
      .createQueryBuilder()
      .delete()
      .where('mode = :mode', { mode: 'real' })
      .andWhere('copied_position_id IN (:...ids)', { ids: archivedPositionIds })
      .execute();

    await manager
      .getRepository(CopiedPosition)
      .createQueryBuilder()
      .delete()
      .where('mode = :mode', { mode: 'real' })
      .andWhere('id IN (:...ids)', { ids: archivedPositionIds })
      .execute();
  }

  async getArchive(
    sessionId: number,
    type: RealArchiveType,
    options: RealArchiveListOptions = {},
  ): Promise<RealArchiveListResult<
    | RealArchivePositionDto
    | RealArchiveExecutionDto
    | RealArchiveExitAttemptDto
  > | null> {
    const session = await this.ds
      .getRepository(RealSessionEntity)
      .findOne({ where: { id: sessionId } });
    if (!session) return null;

    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);
    const summary = parseSummary(session.archiveSummaryJson);

    switch (type) {
      case 'positions': {
        const [items, total] = await this.ds
          .getRepository(RealArchivePosition)
          .findAndCount({
            where: { sessionId },
            order: { id: 'ASC' },
            take: limit,
            skip: offset,
          });
        return {
          summary,
          total,
          items: items.map((row) => ({
            id: row.id,
            sourceId: row.sourceId,
            conditionId: row.conditionId,
            assetId: row.assetId,
            marketTitle: row.marketTitle,
            outcome: row.outcome,
            side: row.side,
            size: row.size,
            entryPrice: row.entryPrice,
            exitPrice: row.exitPrice,
            realizedPnl: row.realizedPnl,
            closeReason: row.closeReason,
            reason: row.reason,
            openedAt: toIso(row.openedAt),
            closedAt: toIso(row.closedAt),
          })),
        };
      }
      case 'executions': {
        const [items, total] = await this.ds
          .getRepository(RealArchiveExecution)
          .findAndCount({
            where: { sessionId },
            order: { id: 'ASC' },
            take: limit,
            skip: offset,
          });
        return {
          summary,
          total,
          items: items.map((row) => ({
            id: row.id,
            sourceId: row.sourceId,
            copiedPositionId: row.copiedPositionId,
            side: row.side,
            fillPrice: row.fillPrice,
            fillQuantity: row.fillQuantity,
            fees: row.fees,
            realizedPnl: row.realizedPnl,
            status: row.status,
            reason: row.reason,
            executedAt: toIso(row.executedAt),
          })),
        };
      }
      case 'exit_attempts': {
        const [items, total] = await this.ds
          .getRepository(RealArchiveExitAttempt)
          .findAndCount({
            where: { sessionId },
            order: { id: 'ASC' },
            take: limit,
            skip: offset,
          });
        return {
          summary,
          total,
          items: items.map((row) => ({
            id: row.id,
            sourceId: row.sourceId,
            copiedPositionId: row.copiedPositionId,
            kind: row.kind,
            closeReason: row.closeReason,
            blockReason: row.blockReason,
            error: row.error,
            markBid: row.markBid,
            createdAt: toIso(row.createdAt)!,
          })),
        };
      }
      default:
        return null;
    }
  }
}
