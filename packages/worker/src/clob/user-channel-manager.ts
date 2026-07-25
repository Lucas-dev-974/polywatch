import type { DataSource } from 'typeorm';
import { ExecutionService } from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import { PolymarketUserWebSocket } from '../polymarket/websocket-user.js';
import { syncUserSubscriptions } from '../polymarket/sync-user-subscriptions.js';
import type { UserWsAuth } from './ws-user-events.js';
import { UserChannelHandler } from './user-channel-handler.js';
import { loadTradingContext } from './trading-context.js';
import { reconcilePlacingExecutions } from './execution-reconciler.js';
import { notifyBackendAlert } from './notify-alert.js';

const log = pino({ name: 'user-channel-manager' });

import type { PositionLockRegistry } from './position-lock-registry.js';

export class UserChannelManager {
  private ws: PolymarketUserWebSocket | null = null;
  private readonly executionService: ExecutionService;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly positionLocks: PositionLockRegistry,
  ) {
    this.executionService = new ExecutionService(ds);
  }

  get socket(): PolymarketUserWebSocket | null {
    return this.ws;
  }

  async ensureConnected(wsAuth: UserWsAuth): Promise<boolean> {
    if (!this.ws) {
      this.ws = new PolymarketUserWebSocket();
      const handler = new UserChannelHandler(
        this.ds,
        this.connectionManager,
        this.ws,
        this.executionService,
        this.positionLocks,
      );
      this.ws.setOnEvent((event) => handler.handle(event));
      this.ws.setOnReconnected(() => {
        void this.handleReconnected();
      });
      this.ws.setOnReconnectExhausted(() => {
        void notifyBackendAlert(
          'error',
          'Canal WebSocket user Polymarket déconnecté (tentatives épuisées) — les fills temps réel ne sont plus suivis.',
        );
      });
    }

    try {
      await this.ws.connect(wsAuth);
      await syncUserSubscriptions(this.ds, this.ws);
      return true;
    } catch (err) {
      log.warn({ err }, 'user channel connection failed');
      this.disconnect();
      return false;
    }
  }

  async syncSubscriptions(): Promise<void> {
    if (this.ws) {
      await syncUserSubscriptions(this.ds, this.ws);
    }
  }

  /**
   * After a successful automatic reconnect: order/trade events may have been
   * missed while offline, so reconcile `placing` executions via REST and
   * refresh the market subscriptions.
   */
  private async handleReconnected(): Promise<void> {
    try {
      const ctx = await loadTradingContext();
      if (ctx) {
        await reconcilePlacingExecutions(this.ds, ctx.clobClient);
      }
      await this.syncSubscriptions();
      log.info('user channel reconnected — placing executions reconciled');
    } catch (err) {
      log.error({ err }, 'post-reconnect reconciliation failed');
    }
  }

  disconnect(): void {
    this.ws?.disconnect();
    this.ws = null;
  }
}
