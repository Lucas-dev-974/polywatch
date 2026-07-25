import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { resolveClosedExitBidVwap } from '../positions/exit-bid.js';
import { SURVEILLANCE_SKIP_PENDING_EXECUTION } from '../positions/reservation-close-reasons.js';
import {
  computeEntryInvestedFromBuyExecutions,
  FILLED_BUY_EXEC_STATUSES,
} from '../simulation/accounting.js';
import type { AlgoSurveillancePositionSummary } from './algo-surveillance.types.js';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

type ExecutionFailureFields = {
  executionErrorSim: string | null;
  executionErrorReal: string | null;
  hasBuyExecution: boolean;
};

function resolveExecutionFailures(executions: Execution[]): ExecutionFailureFields {
  const buyExecs = executions.filter((e) => e.side === 'BUY');
  const failedSim = buyExecs.find((e) => e.mode === 'sim' && e.status === 'failed');
  const failedReal = buyExecs.find((e) => e.mode === 'real' && e.status === 'failed');
  return {
    executionErrorSim: failedSim?.error ?? null,
    executionErrorReal: failedReal?.error ?? null,
    hasBuyExecution: buyExecs.length > 0,
  };
}

async function resolveClosedEntryQuantities(
  ds: DataSource,
  positionIds: number[],
): Promise<Map<number, number>> {
  if (positionIds.length === 0) return new Map();

  const executions = await ds
    .getRepository(Execution)
    .createQueryBuilder('e')
    .where('e.copied_position_id IN (:...ids)', { ids: positionIds })
    .andWhere('e.side = :side', { side: 'BUY' })
    .andWhere('e.status IN (:...statuses)', {
      statuses: [...FILLED_BUY_EXEC_STATUSES],
    })
    .getMany();

  const byPosition = new Map<number, Execution[]>();
  for (const ex of executions) {
    const list = byPosition.get(ex.copiedPositionId) ?? [];
    list.push(ex);
    byPosition.set(ex.copiedPositionId, list);
  }

  const result = new Map<number, number>();
  for (const id of positionIds) {
    const snapshot = computeEntryInvestedFromBuyExecutions(byPosition.get(id) ?? []);
    if (snapshot.quantity > 0) {
      result.set(id, snapshot.quantity);
    }
  }
  return result;
}

function toPositionSummary(
  row: CopiedPosition,
  entryQuantityFilled: number | null,
  exitBidVwap: number | null,
  executionFields: ExecutionFailureFields,
): AlgoSurveillancePositionSummary {
  const skipReason =
    row.status === 'pending' && !executionFields.hasBuyExecution
      ? SURVEILLANCE_SKIP_PENDING_EXECUTION
      : null;

  return {
    id: row.id,
    outcome: row.outcome,
    mode: row.mode,
    status: row.status,
    quantity: row.quantity,
    entryQuantityFilled,
    assetId: row.assetId,
    entryPrice: row.entryPrice,
    entryBidVwap: row.entryBidVwap,
    slBidPoints: row.slBidPoints,
    tpBidPoints: row.tpBidPoints,
    exitBidVwap,
    unrealizedPnl: row.unrealizedPnl,
    realizedPnl: row.realizedPnl,
    openedAt: toIso(row.openedAt),
    closedAt: toIso(row.closedAt),
    reason: row.reason,
    closeReason: row.closeReason,
    executionErrorSim: executionFields.executionErrorSim,
    executionErrorReal: executionFields.executionErrorReal,
    skipReason,
  };
}

/** Refresh close/execution metadata on stored or frozen surveillance summaries. */
export async function enrichAlgoSurveillancePositions(
  ds: DataSource,
  summaries: AlgoSurveillancePositionSummary[],
): Promise<AlgoSurveillancePositionSummary[]> {
  if (summaries.length === 0) return summaries;

  const ids = summaries.map((s) => s.id);
  const [rows, executions] = await Promise.all([
    ds.getRepository(CopiedPosition).find({ where: { id: In(ids) } }),
    ds
      .getRepository(Execution)
      .find({ where: { copiedPositionId: In(ids) }, order: { id: 'ASC' } }),
  ]);

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const execsByPosition = new Map<number, Execution[]>();
  for (const ex of executions) {
    const list = execsByPosition.get(ex.copiedPositionId) ?? [];
    list.push(ex);
    execsByPosition.set(ex.copiedPositionId, list);
  }

  return summaries.map((summary) => {
    const row = rowById.get(summary.id);
    const executionFields = resolveExecutionFailures(
      execsByPosition.get(summary.id) ?? [],
    );
    const status = row?.status ?? summary.status;
    const skipReason =
      status === 'pending' && !executionFields.hasBuyExecution
        ? SURVEILLANCE_SKIP_PENDING_EXECUTION
        : null;

    return {
      ...summary,
      status,
      closeReason: row?.closeReason ?? summary.closeReason ?? null,
      executionErrorSim: executionFields.executionErrorSim,
      executionErrorReal: executionFields.executionErrorReal,
      skipReason,
    };
  });
}

/** Batch-load algo positions grouped by market conditionId. */
export async function loadAlgoPositionsByConditionIds(
  ds: DataSource,
  conditionIds: string[],
  options?: { mode?: 'sim' | 'real' },
): Promise<Map<string, AlgoSurveillancePositionSummary[]>> {
  const grouped = new Map<string, AlgoSurveillancePositionSummary[]>();
  if (conditionIds.length === 0) return grouped;

  const qb = ds
    .getRepository(CopiedPosition)
    .createQueryBuilder('p')
    .where('p.condition_id IN (:...conditionIds)', { conditionIds })
    .andWhere('p.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' })
    .orderBy('p.opened_at', 'DESC')
    .addOrderBy('p.id', 'DESC');

  if (options?.mode) {
    qb.andWhere('p.mode = :mode', { mode: options.mode });
  }

  const positions = await qb.getMany();
  const positionIds = positions.map((p) => p.id);

  const executions =
    positionIds.length === 0
      ? []
      : await ds
          .getRepository(Execution)
          .find({ where: { copiedPositionId: In(positionIds) }, order: { id: 'ASC' } });

  const execsByPosition = new Map<number, Execution[]>();
  for (const ex of executions) {
    const list = execsByPosition.get(ex.copiedPositionId) ?? [];
    list.push(ex);
    execsByPosition.set(ex.copiedPositionId, list);
  }

  const closedForEntryQty = positions
    .filter((p) => p.status === 'closed' && p.quantity <= 0)
    .map((p) => p.id);
  const closedForExit = positions
    .filter((p) => p.status === 'closed')
    .map((p) => p.id);

  const [closedEntryQty, closedExitBids] = await Promise.all([
    resolveClosedEntryQuantities(ds, closedForEntryQty),
    resolveClosedExitBidVwap(ds, closedForExit),
  ]);

  for (const pos of positions) {
    const entryQuantityFilled =
      pos.status === 'closed' && pos.quantity <= 0
        ? closedEntryQty.get(pos.id) ?? null
        : null;
    const exitBidVwap =
      pos.status === 'closed' ? closedExitBids.get(pos.id) ?? null : null;
    const executionFields = resolveExecutionFailures(
      execsByPosition.get(pos.id) ?? [],
    );
    const summary = toPositionSummary(
      pos,
      entryQuantityFilled,
      exitBidVwap,
      executionFields,
    );
    const list = grouped.get(pos.conditionId);
    if (list) list.push(summary);
    else grouped.set(pos.conditionId, [summary]);
  }

  return grouped;
}

/** Capture current algo positions for a market (used when freezing at close). */
export async function captureAlgoPositionsForCondition(
  ds: DataSource,
  conditionId: string,
  options?: { mode?: 'sim' | 'real' },
): Promise<AlgoSurveillancePositionSummary[]> {
  const map = await loadAlgoPositionsByConditionIds(ds, [conditionId], options);
  return map.get(conditionId) ?? [];
}

export function parseFrozenAlgoPositions(
  positionsJson: string | null,
): AlgoSurveillancePositionSummary[] | null {
  if (!positionsJson) return null;
  try {
    const parsed = JSON.parse(positionsJson) as AlgoSurveillancePositionSummary[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
