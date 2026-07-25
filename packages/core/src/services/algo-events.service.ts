import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import type { AlgoEvent, AlgoEventStatus } from '../types/index.js';
import { AlgoSurveillanceService } from './algo-surveillance.service.js';
import { loadAlgoPositionsByConditionIds } from './algo-surveillance-positions.js';
import type { AlgoSurveillancePositionSummary } from './algo-surveillance.types.js';
import { Execution } from '../entities/Execution.js';
import {
  isSurveillanceLive,
  isSurveillanceAwaitingClose,
  type AlgoSurveillanceSnapshotDto,
} from './algo-surveillance.types.js';

function computeStatus(snapshot: AlgoSurveillanceSnapshotDto): AlgoEventStatus {
  if (snapshot.unresolvedAt) return 'unresolved';
  if (snapshot.winningOutcome) return 'resolved';
  const nowMs = Date.now();
  if (isSurveillanceLive(snapshot, nowMs)) return 'live';
  if (isSurveillanceAwaitingClose(snapshot, nowMs)) return 'awaiting_close';
  return 'resolved';
}

function computeAverageSlippage(executions: Execution[]): number | null {
  let totalQty = 0;
  let totalSlippage = 0;
  for (const exec of executions) {
    if (
      !exec.referenceVwap ||
      exec.referenceVwap <= 0 ||
      !exec.fillQuantity ||
      exec.fillQuantity <= 0 ||
      !exec.fillPrice ||
      exec.fillPrice <= 0
    ) {
      continue;
    }
    const slippage =
      exec.side === 'SELL'
        ? exec.referenceVwap - exec.fillPrice
        : exec.fillPrice - exec.referenceVwap;
    totalQty += exec.fillQuantity;
    totalSlippage += slippage * exec.fillQuantity;
  }
  if (totalQty <= 0) return null;
  return totalSlippage / totalQty;
}

async function enrichWithExecutionData(
  positions: AlgoSurveillancePositionSummary[],
  ds: DataSource,
): Promise<{
  executedSim: boolean;
  executedReal: boolean;
  slippage: number | null;
  executionErrorSim: string | null;
  executionErrorReal: string | null;
}> {
  if (positions.length === 0) {
    return {
      executedSim: false,
      executedReal: false,
      slippage: null,
      executionErrorSim: null,
      executionErrorReal: null,
    };
  }

  const positionIds = positions.map((p) => p.id);
  const executions = await ds
    .getRepository(Execution)
    .find({
      where: { copiedPositionId: In(positionIds) },
      order: { id: 'ASC' },
    });

  const buyExecs = executions.filter((e) => e.side === 'BUY');

  return {
    executedSim: buyExecs.some(
      (e) =>
        e.mode === 'sim' &&
        (e.status === 'filled' || e.status === 'partial') &&
        (e.fillQuantity ?? 0) > 0,
    ),
    executedReal: buyExecs.some(
      (e) =>
        e.mode === 'real' &&
        (e.status === 'filled' || e.status === 'partial') &&
        (e.fillQuantity ?? 0) > 0,
    ),
    slippage: computeAverageSlippage(executions),
    executionErrorSim:
      buyExecs.find((e) => e.mode === 'sim' && e.status === 'failed')?.error ??
      null,
    executionErrorReal:
      buyExecs.find((e) => e.mode === 'real' && e.status === 'failed')?.error ??
      null,
  };
}

function toAlgoEvent(
  snapshot: AlgoSurveillanceSnapshotDto,
  execData: {
    executedSim: boolean;
    executedReal: boolean;
    slippage: number | null;
    executionErrorSim: string | null;
    executionErrorReal: string | null;
  },
): AlgoEvent {
  return {
    source: 'algo',
    id: snapshot.id,
    conditionId: snapshot.conditionId,
    question: snapshot.question ?? '',
    cryptoSymbol: snapshot.cryptoSymbol,
    interval: snapshot.interval,
    slug: snapshot.slug,
    marketStartAt: snapshot.marketStartAt,
    marketEndAt: snapshot.marketEndAt,
    openUpPrice: snapshot.openUpPrice,
    openDownPrice: snapshot.openDownPrice,
    openCapturedAt: snapshot.openCapturedAt,
    closeUpPrice: snapshot.closeUpPrice,
    closeDownPrice: snapshot.closeDownPrice,
    closeCapturedAt: snapshot.closeCapturedAt,
    winningOutcome: snapshot.winningOutcome,
    unresolvedAt: snapshot.unresolvedAt,
    executedSim: execData.executedSim,
    executedReal: execData.executedReal,
    copySlippage: execData.slippage,
    executionErrorSim: execData.executionErrorSim,
    executionErrorReal: execData.executionErrorReal,
    status: computeStatus(snapshot),
  };
}

export class AlgoEventsService {
  private readonly surveillanceService: AlgoSurveillanceService;

  constructor(private readonly ds: DataSource) {
    this.surveillanceService = new AlgoSurveillanceService(ds);
  }

  async loadRecent(options: {
    limit: number;
    offset?: number;
  }): Promise<{ items: AlgoEvent[]; total: number }> {
    const { items: snapshots, total } = await this.surveillanceService.listHistory(
      options.limit,
      options.offset ?? 0,
    );

    if (snapshots.length === 0) {
      return { items: [], total };
    }

    const conditionIds = snapshots.map((s) => s.conditionId);
    const positionsByCondition = await loadAlgoPositionsByConditionIds(
      this.ds,
      conditionIds,
    );

    const enrichedSnapshots = await Promise.all(
      snapshots.map(async (snapshot) => {
        const positions = positionsByCondition.get(snapshot.conditionId) ?? [];
        const execData = await enrichWithExecutionData(positions, this.ds);
        return toAlgoEvent(snapshot, execData);
      }),
    );

    return { items: enrichedSnapshots, total };
  }
}
