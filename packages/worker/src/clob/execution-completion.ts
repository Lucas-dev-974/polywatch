import type { DataSource } from 'typeorm';
import {
  ExecutionService,
  type CopiedPosition,
  type ExecutionResult,
  type FinalizeInput,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import { syncBookSubscriptions } from '../polymarket/sync-book-subscriptions.js';
import { syncUserSubscriptions } from '../polymarket/sync-user-subscriptions.js';
import type { PolymarketUserWebSocket } from '../polymarket/websocket-user.js';
import { invalidateRealBalanceCache } from '../sizing/real-balance-cache.js';
import type { PositionLockRegistry } from './position-lock-registry.js';
import { notifyAlgoSlQuotaInvalidateFromClose } from '../algo-sl-quota-invalidate.js';
import { withTimeout } from './with-timeout.js';

const log = pino({ name: 'execution-completion' });

/** Max time finalize() waits for book/user subscription sync. Must stay well below
 * the 60s position-lock timeout so a slow external API does not turn a sim fill
 * into a placing orphan. */
const SYNC_SUBSCRIPTIONS_FINALIZE_TIMEOUT_MS = 10_000;

export interface CompleteExecutionOptions {
  source?: string;
  userWs?: PolymarketUserWebSocket | null;
  exitReason?: string | null;
}

export function parseExecutionResultExecutedAt(
  value: Date | string | number | undefined,
): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export function executionResultToFinalizeInput(
  result: ExecutionResult,
): FinalizeInput {
  const executedAt = parseExecutionResultExecutedAt(
    result.executedAt as Date | string | number | undefined,
  );
  return {
    orderSignalId: result.orderSignalId,
    status: result.status,
    fillPrice: result.fillPrice,
    fillQuantity: result.fillQuantity,
    fees: result.fees,
    entryBidVwap: result.entryBidVwap,
    txHash: result.txHash,
    clobOrderId: result.clobOrderId,
    error: result.error,
    referenceVwap: result.referenceVwap,
    slippagePercent: result.slippagePercent,
    ...(executedAt != null ? { executedAt } : {}),
  };
}

export async function completeExecutionLocked(
  positionLocks: PositionLockRegistry,
  positionId: number,
  ds: DataSource,
  executionService: ExecutionService,
  connectionManager: PolymarketConnectionManager,
  input: FinalizeInput,
  options: CompleteExecutionOptions = {},
): Promise<CopiedPosition | null> {
  let pos: CopiedPosition | null = null;
  await positionLocks.runSequentially(positionId, async () => {
    pos = await completeExecution(
      ds,
      executionService,
      connectionManager,
      input,
      options,
    );
  });
  return pos;
}

export async function completeExecution(
  ds: DataSource,
  executionService: ExecutionService,
  connectionManager: PolymarketConnectionManager,
  input: FinalizeInput,
  options: CompleteExecutionOptions = {},
): Promise<CopiedPosition | null> {
  const pos = await executionService.finalize(input);
  if (!pos) return null;

  const finalizeLagMs =
    input.executedAt != null ? Date.now() - input.executedAt.getTime() : undefined;

  log.info(
    {
      orderSignalId: input.orderSignalId,
      status: input.status,
      positionId: pos.id,
      source: options.source ?? 'executor',
      finalize_lag_ms: finalizeLagMs,
    },
    'execution finalized',
  );

  if (input.status === 'filled' && pos.mode === 'real') {
    invalidateRealBalanceCache();
  }

  if (pos.status === 'closed') {
    notifyAlgoSlQuotaInvalidateFromClose(pos, options.exitReason);
  }

  // refresh=false: reconcile() already fetches REST snapshots for newly
  // subscribed assets; a full refresh here re-downloads every active book
  // after each fill and hammers the REST API for nothing.
  //
  // Fire-and-forget with timeout: subscription sync calls external APIs that can
  // hang or slow down under load. It must never block the execution finalization
  // path or the position-lock timeout will mark the execution as placing_orphan.
  const syncStart = Date.now();
  withTimeout(
    syncBookSubscriptions(ds, connectionManager, false),
    SYNC_SUBSCRIPTIONS_FINALIZE_TIMEOUT_MS,
    'sync_book_subscriptions_finalize_timeout',
  ).catch((err) => {
    log.warn(
      {
        err,
        orderSignalId: input.orderSignalId,
        positionId: pos.id,
        syncDurationMs: Date.now() - syncStart,
      },
      'syncBookSubscriptions during finalize failed/timed out — continuing',
    );
  });

  if (options.userWs) {
    withTimeout(
      syncUserSubscriptions(ds, options.userWs),
      SYNC_SUBSCRIPTIONS_FINALIZE_TIMEOUT_MS,
      'sync_user_subscriptions_finalize_timeout',
    ).catch((err) => {
      log.warn(
        { err, orderSignalId: input.orderSignalId, positionId: pos.id },
        'syncUserSubscriptions during finalize failed/timed out — continuing',
      );
    });
  }

  return pos;
}
