import WebSocket from 'ws';
import pino from 'pino';
import { config } from '../config.js';
import type { UserWsAuth } from '../clob/ws-user-events.js';
import {
  WS_BASE_RECONNECT_DELAY_MS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
} from '../constants.js';

const log = pino({ name: 'websocket-user' });

export type UserChannelEvent =
  | { kind: 'trade'; payload: Record<string, unknown> }
  | { kind: 'order'; payload: Record<string, unknown> };

/**
 * Authenticated Polymarket CLOB user channel for async order/trade updates.
 *
 * @see https://docs.polymarket.com/market-data/websocket/user-channel
 */
export class PolymarketUserWebSocket {
  private ws: WebSocket | null = null;
  private auth: UserWsAuth | null = null;
  private subscribedMarkets = new Set<string>();
  private healthy = false;
  private reconnectAttempts = 0;
  private reconnectExhaustedNotified = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wasDisconnected = false;
  private onEvent?: (event: UserChannelEvent) => void;
  private onReconnected?: () => void;
  private onReconnectExhausted?: () => void;

  setOnEvent(cb: (event: UserChannelEvent) => void): void {
    this.onEvent = cb;
  }

  /** Invoked after an automatic reconnect succeeds (events may have been missed). */
  setOnReconnected(cb: () => void): void {
    this.onReconnected = cb;
  }

  /** Invoked when the reconnect budget is exhausted (channel permanently down). */
  setOnReconnectExhausted(cb: () => void): void {
    this.onReconnectExhausted = cb;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async connect(auth: UserWsAuth): Promise<void> {
    this.auth = auth;
    this.cancelReconnect();
    if (this.ws) {
      this.disposeSocket(this.ws);
      this.ws = null;
    }
    return this.openSocket();
  }

  /** Reconcile condition-ID subscriptions (markets) for the user channel. */
  reconcileMarkets(conditionIds: string[]): void {
    const next = new Set(conditionIds.filter(Boolean));

    for (const market of this.subscribedMarkets) {
      if (!next.has(market)) {
        this.subscribedMarkets.delete(market);
        this.sendMarketOperation('unsubscribe', [market]);
      }
    }

    const toAdd = [...next].filter((m) => !this.subscribedMarkets.has(m));
    for (const market of toAdd) {
      this.subscribedMarkets.add(market);
    }

    if (toAdd.length > 0) {
      if (this.ws?.readyState === WebSocket.OPEN && this.auth) {
        this.sendMarketOperation('subscribe', toAdd);
      }
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.cancelReconnect();
    this.healthy = false;
    // Clearing auth makes scheduleReconnect a no-op if a late 'close' event
    // fires after shutdown — otherwise the socket would resurrect itself.
    this.auth = null;
    this.wasDisconnected = false;
    if (this.ws) {
      this.disposeSocket(this.ws);
      this.ws = null;
    }
  }

  /** Close or terminate without throwing when the socket is still handshaking. */
  private disposeSocket(ws: WebSocket): void {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
      return;
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      try {
        ws.close(1000, 'shutdown');
      } catch (err) {
        log.warn({ err }, 'user ws close failed — terminating');
        ws.terminate();
      }
    }
  }

  private openSocket(): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('user_ws_auth_missing'));
    }

    return new Promise((resolve, reject) => {
      try {
        log.info({ wsUrl: config.wsUserUrl }, 'connecting to polymarket user ws');
        this.ws = new WebSocket(config.wsUserUrl);

        this.ws.on('open', () => {
          log.info('polymarket user ws connected');
          this.healthy = true;
          this.reconnectAttempts = 0;
          this.reconnectExhaustedNotified = false;
          this.startHeartbeat();
          this.sendInitialSubscription();
          if (this.wasDisconnected) {
            // Fills/cancellations may have happened while offline — let the
            // owner reconcile `placing` executions against the CLOB REST API.
            this.wasDisconnected = false;
            this.onReconnected?.();
          }
          resolve();
        });

        this.ws.on('message', (raw: Buffer) => {
          this.handleMessage(raw);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          log.warn({ code, reason: reason.toString() }, 'polymarket user ws closed');
          this.healthy = false;
          this.wasDisconnected = true;
          this.stopHeartbeat();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          log.warn({ err }, 'polymarket user ws error');
          this.healthy = false;
        });
      } catch (err) {
        log.error({ err }, 'polymarket user ws connect failed');
        this.healthy = false;
        this.scheduleReconnect();
        reject(err);
      }
    });
  }

  private sendInitialSubscription(): void {
    if (!this.auth) return;
    this.send({
      type: 'user',
      auth: {
        apiKey: this.auth.apiKey,
        secret: this.auth.secret,
        passphrase: this.auth.passphrase,
      },
      markets: [...this.subscribedMarkets],
    });
    log.info(
      { marketCount: this.subscribedMarkets.size },
      'initial user channel subscription sent',
    );
  }

  private sendMarketOperation(
    operation: 'subscribe' | 'unsubscribe',
    markets: string[],
  ): void {
    if (markets.length === 0) return;
    this.send({ markets, operation });
    log.debug({ operation, count: markets.length }, 'user channel market op');
  }

  private send(data: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  private handleMessage(raw: Buffer): void {
    const text = raw.toString();
    if (text === 'PONG') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const events = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
      event_type?: string;
    }>;

    for (const msg of events) {
      const eventType = msg?.event_type;
      if (eventType === 'trade') {
        this.onEvent?.({ kind: 'trade', payload: msg as Record<string, unknown> });
      } else if (eventType === 'order') {
        this.onEvent?.({ kind: 'order', payload: msg as Record<string, unknown> });
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (!this.auth) return;

    const delay = WS_BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'scheduling user ws reconnect');

    // Log a warning when attempts exceed the traditional threshold
    if (this.reconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
      log.warn(
        { attempt: this.reconnectAttempts, threshold: WS_MAX_RECONNECT_ATTEMPTS },
        'user ws reconnect exceeded threshold — continuing indefinitely with backoff',
      );
      if (!this.reconnectExhaustedNotified) {
        this.reconnectExhaustedNotified = true;
        this.onReconnectExhausted?.();
      }
    }

    // Cap the delay at ~5 minutes to avoid unbounded wait
    const cappedDelay = Math.min(delay, 300_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((err) => {
        log.warn({ err }, 'user ws reconnect failed');
      });
    }, cappedDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
