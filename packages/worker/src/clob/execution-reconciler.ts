import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import {
  CopiedPosition,
  ExecutionService,
  MarketService,
  Execution,
  type ExecutionResult,
  type FinalizeInput,
  type PlatformFeeParams,
} from '@polywatch/core';
import type { ClobClient } from '@polymarket/clob-client-v2';
import pino from 'pino';
import {
  openOrderToFinalizeInput,
  pickMatchingTrade,
  tradeToFinalizeInput,
  type ClobOpenOrderLike,
  type ClobTradeLike,
} from './startup-reconciler.js';
import { completeExecution } from './execution-completion.js';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import { loadTradingContextResult } from './trading-context.js';

const log = pino({ name: 'execution-reconciler' });

export async function reconcileExecutionFromClob(
  ds: DataSource,
  clobClient: ClobClient,
  exec: Execution,
  platformFeeParams: PlatformFeeParams,
): Promise<FinalizeInput | null> {
  const requestedQty = exec.requestedQty ?? 0;

  if (exec.clobOrderId) {
    const order = (await clobClient.getOrder(exec.clobOrderId)) as ClobOpenOrderLike | null;
    if (order) {
      const filled = openOrderToFinalizeInput(
        order,
        exec.orderSignalId,
        platformFeeParams,
        exec.fillQuantity ?? 0,
      );
      if (filled) return filled;
    }
  }

  const pos = await ds.getRepository(CopiedPosition).findOne({
    where: { id: exec.copiedPositionId },
  });
  if (!pos) return null;

  const trades = (await clobClient.getTrades(
    { market: pos.conditionId, asset_id: pos.assetId },
    true,
  )) as ClobTradeLike[];

  const trade = pickMatchingTrade(trades, pos.assetId, exec.side, requestedQty);
  if (trade) {
    return tradeToFinalizeInput(trade, exec.orderSignalId, platformFeeParams);
  }

  return null;
}

export async function reconcileInFlightToResult(
  ds: DataSource,
  clobClient: ClobClient,
  exec: Execution,
): Promise<ExecutionResult | null> {
  const marketService = new MarketService(ds);
  const pos = await ds.getRepository(CopiedPosition).findOne({
    where: { id: exec.copiedPositionId },
  });
  if (!pos) return null;

  const platformFeeParams = await marketService.resolvePlatformFeeParams(
    pos.conditionId,
  );
  const input = await reconcileExecutionFromClob(
    ds,
    clobClient,
    exec,
    platformFeeParams,
  );
  if (!input) return null;

  const executionService = new ExecutionService(ds);
  await executionService.finalize(input);
  const updated = await ds.getRepository(Execution).findOne({
    where: { orderSignalId: exec.orderSignalId },
  });
  if (!updated) return null;
  return executionService.toExecutionResult(updated);
}

export async function reconcileInFlightIfReal(
  ds: DataSource,
  exec: Execution,
): Promise<ExecutionResult | null> {
  const trading = await loadTradingContextResult();
  if (!trading.ok) return null;
  return reconcileInFlightToResult(ds, trading.context.clobClient, exec);
}

export async function reconcilePlacingExecutions(
  ds: DataSource,
  clobClient: ClobClient,
  connectionManager?: PolymarketConnectionManager,
): Promise<void> {
  const executionService = new ExecutionService(ds);
  const marketService = new MarketService(ds);
  const execs = await executionService.loadReconcilableReal();
  if (execs.length === 0) return;

  log.info({ count: execs.length }, 'reconciling real executions');

  const positionIds = [...new Set(execs.map((e) => e.copiedPositionId))];
  const positions = await ds.getRepository(CopiedPosition).find({
    where: { id: In(positionIds) },
  });
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const feeParamsByCondition = new Map<string, PlatformFeeParams>();

  async function platformFeeParamsFor(conditionId: string): Promise<PlatformFeeParams> {
    const cached = feeParamsByCondition.get(conditionId);
    if (cached) return cached;
    const resolved = await marketService.resolvePlatformFeeParams(conditionId);
    feeParamsByCondition.set(conditionId, resolved);
    return resolved;
  }

  for (const exec of execs) {
    const pos = positionById.get(exec.copiedPositionId);
    if (!pos) {
      log.warn({ orderSignalId: exec.orderSignalId }, 'position missing for execution');
      continue;
    }

    try {
      const platformFeeParams = await platformFeeParamsFor(pos.conditionId);
      const input = await reconcileExecutionFromClob(
        ds,
        clobClient,
        exec,
        platformFeeParams,
      );

      if (input) {
        if (connectionManager) {
          await completeExecution(ds, executionService, connectionManager, input, {
            source: 'startup_reconciler',
            exitReason: exec.reason,
          });
        } else {
          await executionService.finalize(input);
        }
        log.info({ orderSignalId: exec.orderSignalId }, 'reconciled via CLOB');
        continue;
      }

      if (exec.status === 'placing' || exec.status === 'live_on_clob') {
        continue;
      }

      await executionService.finalize({
        orderSignalId: exec.orderSignalId,
        status: 'failed',
        fillPrice: 0,
        fillQuantity: 0,
        fees: 0,
        error: 'reconciled_no_fill',
      });
      log.warn({ orderSignalId: exec.orderSignalId }, 'no CLOB fill found — marked failed');
    } catch (err) {
      log.error({ err, orderSignalId: exec.orderSignalId }, 'reconciliation failed');
    }
  }
}
