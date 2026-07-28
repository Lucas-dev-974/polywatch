import type { DataSource, EntityManager } from 'typeorm';
import type { SimulationSession } from '../entities/SimulationSession.js';
import { SimulationSession as SimulationSessionEntity } from '../entities/SimulationSession.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { MarketPositionTick } from '../entities/MarketPositionTick.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import { AlgoPriceTick } from '../entities/AlgoPriceTick.js';
import { MarketPriceTick } from '../entities/MarketPriceTick.js';
import { SimArchivePosition } from '../entities/SimArchivePosition.js';
import { SimArchiveExecution } from '../entities/SimArchiveExecution.js';
import { SimArchiveExitAttempt } from '../entities/SimArchiveExitAttempt.js';
import { SimArchiveSurveillance } from '../entities/SimArchiveSurveillance.js';
import { SimArchivePriceCandle } from '../entities/SimArchivePriceCandle.js';
import { algoKindFromReason, type SimAlgoKind } from '../simulation/algo-kind.js';
import { In } from 'typeorm';
import type {
  SimArchiveCandleDto,
  SimArchiveExecutionDto,
  SimArchiveExitAttemptDto,
  SimArchiveListOptions,
  SimArchiveListResult,
  SimArchivePositionDto,
  SimArchiveSummary,
  SimArchiveSurveillanceDto,
  SimArchiveType,
} from '../types/sim-session-archive.js';
import {
  aggregateAlgoTickPrice,
  aggregateMarketTickPrice,
  buildCandlesFromTicks,
} from '../simulation/archive-price-candles.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** TypeORM/pg fail on very large multi-row INSERTs (65535 param cap + driver bugs). */
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

function parseSummary(json: string | null): SimArchiveSummary | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as SimArchiveSummary;
  } catch {
    return null;
  }
}

export class SimulationResetArchiveService {
  constructor(private readonly ds: DataSource) {}

  async archiveSession(
    manager: EntityManager,
    session: SimulationSession,
  ): Promise<SimArchiveSummary> {
    const sessionId = session.id;
    const startedAt = session.startedAt;
    const algoKind = session.algoKind ?? 'crypto';

    const allSimPositions = await manager.find(CopiedPosition, {
      where: { mode: 'sim' },
    });
    const simPositions = allSimPositions.filter(
      (p) => algoKindFromReason(p.reason) === algoKind,
    );
    const positionIds = simPositions.map((p) => p.id);
    const conditionIds = [...new Set(simPositions.map((p) => p.conditionId))];

    const positions = simPositions.length;
    const simExecutions =
      positionIds.length > 0
        ? await manager.find(Execution, {
            where: { mode: 'sim', copiedPositionId: In(positionIds) },
          })
        : [];
    const executions = simExecutions.length;

    let exitAttemptRows: ExitAttemptEvent[] = [];
    if (positionIds.length > 0) {
      exitAttemptRows = await manager
        .getRepository(ExitAttemptEvent)
        .createQueryBuilder('ea')
        .where("(ea.mode = 'sim' OR ea.mode IS NULL)")
        .andWhere('ea.created_at >= :startedAt', { startedAt })
        .andWhere('ea.copied_position_id IN (:...positionIds)', { positionIds })
        .getMany();
    }
    const exitAttempts = exitAttemptRows.length;

    let surveillance = 0;
    let surveillanceRows: AlgoSurveillanceSnapshot[] = [];
    if (algoKind === 'crypto' && conditionIds.length > 0) {
      surveillanceRows = await manager.find(AlgoSurveillanceSnapshot, {
        where: { conditionId: In(conditionIds) },
      });
      surveillance = surveillanceRows.length;
    }

    if (simPositions.length > 0) {
      await insertInChunks(
        manager,
        SimArchivePosition,
        simPositions.map((cp) => ({
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

    if (simExecutions.length > 0) {
      await insertInChunks(
        manager,
        SimArchiveExecution,
        simExecutions.map((e) => ({
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

    if (exitAttemptRows.length > 0) {
      await insertInChunks(
        manager,
        SimArchiveExitAttempt,
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

    if (surveillanceRows.length > 0) {
      await insertInChunks(
        manager,
        SimArchiveSurveillance,
        surveillanceRows.map((s) => ({
          sessionId,
          sourceId: s.id,
          conditionId: s.conditionId,
          question: s.question,
          cryptoSymbol: s.cryptoSymbol,
          interval: s.interval,
          slug: s.slug,
          marketStartAt: s.marketStartAt,
          marketEndAt: s.marketEndAt,
          openUpPrice: s.openUpPrice,
          openDownPrice: s.openDownPrice,
          closeUpPrice: s.closeUpPrice,
          closeDownPrice: s.closeDownPrice,
          winningOutcome: s.winningOutcome,
          positionsJson: s.positionsJson,
          rawJson: JSON.stringify(s),
        })),
      );
    }

    await this.archivePriceCandles(
      manager,
      sessionId,
      startedAt,
      algoKind,
      conditionIds,
      positionIds,
    );

    const candleRow = await manager.query(
      `
      SELECT COUNT(*)::int AS count,
        MIN(bucket_start) AS period_from,
        MAX(bucket_start) AS period_to
      FROM sim_archive_price_candles
      WHERE session_id = $1
      `,
      [sessionId],
    );
    const candles = Number(candleRow[0]?.count ?? 0);
    const periodFrom = candleRow[0]?.period_from
      ? toIso(new Date(candleRow[0].period_from))
      : toIso(startedAt);
    const periodTo = candleRow[0]?.period_to
      ? toIso(new Date(candleRow[0].period_to))
      : toIso(new Date());

    const summary: SimArchiveSummary = {
      positions,
      executions,
      exitAttempts,
      surveillance,
      candles,
      periodFrom,
      periodTo,
    };

    await manager.getRepository(SimulationSessionEntity).update(sessionId, {
      archiveSummaryJson: JSON.stringify(summary),
    });

    return summary;
  }

  private async archivePriceCandles(
    manager: EntityManager,
    sessionId: number,
    startedAt: Date,
    algoKind: SimAlgoKind,
    conditionIds: string[],
    positionIds: number[],
  ): Promise<void> {
    if (conditionIds.length === 0 && positionIds.length === 0) return;

    const algoTicks =
      algoKind === 'crypto' && conditionIds.length > 0
        ? await manager
            .getRepository(AlgoPriceTick)
            .createQueryBuilder('t')
            .where('t.recorded_at >= :startedAt', { startedAt })
            .andWhere('t.condition_id IN (:...conditionIds)', { conditionIds })
            .getMany()
        : [];

    const marketTicks =
      conditionIds.length > 0
        ? await manager
            .getRepository(MarketPriceTick)
            .createQueryBuilder('t')
            .where('t.recorded_at >= :startedAt', { startedAt })
            .andWhere('t.condition_id IN (:...conditionIds)', { conditionIds })
            .getMany()
        : [];

    const positionTicks =
      positionIds.length > 0
        ? await manager
            .getRepository(MarketPositionTick)
            .createQueryBuilder('mpt')
            .where('mpt.copied_position_id IN (:...positionIds)', { positionIds })
            .andWhere('mpt.created_at >= :startedAt', { startedAt })
            .select([
              'mpt.condition_id',
              'mpt.asset_id',
              'mpt.mid_price',
              'mpt.created_at',
            ])
            .getRawMany<{
              condition_id: string;
              asset_id: string;
              mid_price: number;
              created_at: Date;
            }>()
        : [];

    const candleInputs = [
      ...algoTicks.map((t) => ({
        source: 'algo' as const,
        conditionId: t.conditionId,
        assetId: t.conditionId,
        at: t.recordedAt,
        price: aggregateAlgoTickPrice(t.upPrice, t.downPrice),
      })),
      ...marketTicks.map((t) => ({
        source: 'market' as const,
        conditionId: t.conditionId,
        assetId: t.assetId,
        at: t.recordedAt,
        price: aggregateMarketTickPrice(t),
      })),
      ...positionTicks.map((t) => ({
        source: 'position' as const,
        conditionId: t.condition_id,
        assetId: t.asset_id,
        at: t.created_at,
        price: t.mid_price,
      })),
    ];

    const candles = buildCandlesFromTicks(candleInputs);
    if (candles.length === 0) return;

    await insertInChunks(
      manager,
      SimArchivePriceCandle,
      candles.map((c) => ({
        sessionId,
        source: c.source,
        conditionId: c.conditionId,
        assetId: c.assetId,
        bucketStart: c.bucketStart,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        tickCount: c.tickCount,
      })),
    );
  }

  async purgeAlgoScopedMarketData(
    manager: EntityManager,
    algoKind: SimAlgoKind,
    positionIds: number[],
    conditionIds: string[],
  ): Promise<void> {
    if (positionIds.length > 0) {
      await manager.delete(MarketPositionTick, {
        copiedPositionId: In(positionIds),
      });
      await manager.delete(ExitAttemptEvent, {
        copiedPositionId: In(positionIds),
      });
    }

    if (algoKind === 'crypto' && conditionIds.length > 0) {
      await manager
        .getRepository(AlgoSurveillanceSnapshot)
        .createQueryBuilder()
        .delete()
        .where('condition_id IN (:...conditionIds)', { conditionIds })
        .andWhere(
          '(close_captured_at IS NOT NULL OR unresolved_at IS NOT NULL)',
        )
        .execute();
    }
  }

  /** @deprecated Use purgeAlgoScopedMarketData — kept for callers migrating. */
  async purgeMarketData(
    manager: EntityManager,
    algoKind: SimAlgoKind = 'crypto',
    positionIds: number[] = [],
    conditionIds: string[] = [],
  ): Promise<void> {
    await this.purgeAlgoScopedMarketData(
      manager,
      algoKind,
      positionIds,
      conditionIds,
    );
  }

  async getArchive(
    sessionId: number,
    type: SimArchiveType,
    options: SimArchiveListOptions = {},
  ): Promise<SimArchiveListResult<
    | SimArchivePositionDto
    | SimArchiveExecutionDto
    | SimArchiveExitAttemptDto
    | SimArchiveSurveillanceDto
    | SimArchiveCandleDto
  > | null> {
    const session = await this.ds
      .getRepository(SimulationSessionEntity)
      .findOne({ where: { id: sessionId } });
    if (!session) return null;

    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);
    const summary = parseSummary(session.archiveSummaryJson);

    switch (type) {
      case 'positions': {
        const [items, total] = await this.ds
          .getRepository(SimArchivePosition)
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
          .getRepository(SimArchiveExecution)
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
          .getRepository(SimArchiveExitAttempt)
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
      case 'surveillance': {
        const [items, total] = await this.ds
          .getRepository(SimArchiveSurveillance)
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
            question: row.question,
            cryptoSymbol: row.cryptoSymbol,
            interval: row.interval,
            winningOutcome: row.winningOutcome,
            positionsJson: row.positionsJson,
          })),
        };
      }
      case 'candles': {
        const [items, total] = await this.ds
          .getRepository(SimArchivePriceCandle)
          .findAndCount({
            where: { sessionId },
            order: { bucketStart: 'ASC', id: 'ASC' },
            take: limit,
            skip: offset,
          });
        return {
          summary,
          total,
          items: items.map((row) => ({
            id: row.id,
            source: row.source,
            conditionId: row.conditionId,
            assetId: row.assetId,
            bucketStart: toIso(row.bucketStart)!,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            tickCount: row.tickCount,
          })),
        };
      }
      default:
        return null;
    }
  }
}
