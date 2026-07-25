import type { DataSource } from 'typeorm';
import {
  ExecutionService,
  type Execution,
  type FinalizeInput,
  type PlatformFeeParams,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import type { UserChannelEvent } from '../polymarket/websocket-user.js';
import type { PolymarketUserWebSocket } from '../polymarket/websocket-user.js';
import { completeExecutionLocked } from './execution-completion.js';
import { notifyBackendExecution } from './notify-execution.js';
import type { PositionLockRegistry } from './position-lock-registry.js';
import { resolvePlatformFeeParams } from './resolve-platform-fee-params.js';
import {
  isActionableOrderUpdate,
  isActionableTradeEvent,
  isOrderCancellation,
  orderCancellationToFinalizeInput,
  orderEventToFinalizeInput,
  resolveClobOrderIdFromOrder,
  resolveClobOrderIdFromTrade,
  shouldPreferOrderUpdateForFill,
  tradeEventToFinalizeInput,
  type UserOrderEvent,
  type UserTradeEvent,
} from './ws-user-events.js';

const log = pino({ name: 'user-channel-handler' });

export class UserChannelHandler {
  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly userWs: PolymarketUserWebSocket,
    private readonly executionService: ExecutionService,
    private readonly positionLocks: PositionLockRegistry,
  ) {}

  handle(event: UserChannelEvent): void {
    void this.handleAsync(event).catch((err) => {
      log.error({ err, kind: event.kind }, 'user channel event handling failed');
    });
  }

  private async handleAsync(event: UserChannelEvent): Promise<void> {
    if (event.kind === 'trade') {
      await this.handleTrade(event.payload as unknown as UserTradeEvent);
      return;
    }
    await this.handleOrder(event.payload as unknown as UserOrderEvent);
  }

  private async handleTrade(event: UserTradeEvent): Promise<void> {
    if (!isActionableTradeEvent(event)) return;
    const clobOrderId = resolveClobOrderIdFromTrade(event);
    if (!clobOrderId) return;

    const exec = await this.executionService.findReconcilableRealByClobOrderId(clobOrderId);
    if (!exec) return;

    if (shouldPreferOrderUpdateForFill(exec.status)) return;

    await this.finalizeFromClobOrder(clobOrderId, (signalId, fee) =>
      tradeEventToFinalizeInput(event, signalId, fee),
    );
  }

  private async handleOrder(event: UserOrderEvent): Promise<void> {
    const clobOrderId = resolveClobOrderIdFromOrder(event);
    if (!clobOrderId) return;

    if (isOrderCancellation(event)) {
      await this.finalizeFromClobOrder(clobOrderId, (signalId) =>
        orderCancellationToFinalizeInput(signalId, clobOrderId),
      );
      return;
    }

    if (!isActionableOrderUpdate(event)) return;
    await this.finalizeFromClobOrder(clobOrderId, (signalId, fee, exec) =>
      orderEventToFinalizeInput(
        event,
        signalId,
        fee,
        exec?.fillQuantity ?? 0,
      ),
    );
  }

  private async finalizeFromClobOrder(
    clobOrderId: string,
    buildInput: (
      orderSignalId: string,
      platformFeeParams: PlatformFeeParams,
      exec?: Execution | null,
    ) => FinalizeInput | null | undefined,
  ): Promise<void> {
    if (!clobOrderId) return;

    const exec = await this.executionService.findReconcilableRealByClobOrderId(clobOrderId);
    if (!exec) return;

    const platformFeeParams = await resolvePlatformFeeParams(
      this.ds,
      exec.copiedPositionId,
    );
    const input = buildInput(exec.orderSignalId, platformFeeParams, exec);
    if (!input) return;

    const pos = await completeExecutionLocked(
      this.positionLocks,
      exec.copiedPositionId,
      this.ds,
      this.executionService,
      this.connectionManager,
      input,
      { source: 'user_ws', exitReason: exec.reason },
    );

    // Notify backend outside the position lock — fire-and-forget with timeout
    // and circuit breaker so a slow/dead backend never blocks the pipeline.
    if (pos) {
      void notifyBackendExecution({
        orderSignalId: input.orderSignalId,
        status: input.status,
        fillPrice: input.fillPrice,
        fillQuantity: input.fillQuantity,
        fees: input.fees,
        txHash: input.txHash,
        clobOrderId: input.clobOrderId,
        error: input.error,
      });
    }
  }
}
