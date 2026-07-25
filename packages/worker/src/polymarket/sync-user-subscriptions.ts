import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import {
  CopiedPosition,
  CopiedPositionService,
  ExecutionService,
} from '@polywatch/core';
import type { PolymarketUserWebSocket } from './websocket-user.js';

/**
 * Reconcile user-channel subscriptions by condition IDs for active real positions
 * and any executions still in `placing`.
 */
export async function syncUserSubscriptions(
  ds: DataSource,
  userWs: PolymarketUserWebSocket,
  positionService?: CopiedPositionService,
): Promise<void> {
  const svc = positionService ?? new CopiedPositionService(ds);
  const executionService = new ExecutionService(ds);

  const conditionIds = new Set<string>();

  const active = await svc.loadActive();
  for (const pos of active) {
    if (pos.mode === 'real' && pos.conditionId) {
      conditionIds.add(pos.conditionId);
    }
  }

  const placing = await executionService.loadPlacingReal();
  if (placing.length > 0) {
    const positionIds = [...new Set(placing.map((e) => e.copiedPositionId))];
    const positions = await ds.getRepository(CopiedPosition).find({
      where: { id: In(positionIds) },
    });
    for (const pos of positions) {
      if (pos.conditionId) conditionIds.add(pos.conditionId);
    }
  }

  userWs.reconcileMarkets([...conditionIds]);
}
