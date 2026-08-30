import type { DataSource } from 'typeorm';
import {
  ExecutionService,
  ReservationService,
  resumeEntryFromReservation,
  WORKER_QUEUES,
  type OrderSignal,
  type EntryOpenReason,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import type { RedisQueue } from '../queue/redis-queue.js';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'pending-entry-janitor' });

export const PENDING_ENTRY_JANITOR_REASONS = ['ALGO_OPEN', 'WEATHER_OPEN'] as const;

export function queueForPendingEntryReason(
  reason: string,
): 'algo' | 'weather' | null {
  if (reason === 'WEATHER_OPEN') return 'weather';
  if (reason === 'ALGO_OPEN') return 'algo';
  return null;
}

type OrphanRow = {
  position_id: number;
  order_signal_id: string;
  reservation_id: number;
  reserved_notional_pusd: number;
  expires_at: Date;
  condition_id: string;
  asset_id: string;
  mode: 'sim' | 'real';
  reason: string;
};

/** Re-enqueue BUY signals when a pending position has a reservation but no execution. */
export class PendingEntryJanitor {
  private reservationService: ReservationService;
  private executionService: ExecutionService;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly algoOrderQueue: RedisQueue<OrderSignal>,
    private readonly weatherOrderQueue: RedisQueue<OrderSignal>,
  ) {
    this.reservationService = new ReservationService(ds);
    this.executionService = new ExecutionService(ds);
  }

  async run(): Promise<void> {
    const orphans = await this.loadOrphanPendingEntries();
    for (const row of orphans) {
      const expiresAt =
        row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at);
      if (expiresAt.getTime() <= Date.now()) continue;

      const queueKind = queueForPendingEntryReason(row.reason);
      if (!queueKind) continue;
      const reason = row.reason as EntryOpenReason;
      const orderQueue =
        queueKind === 'weather' ? this.weatherOrderQueue : this.algoOrderQueue;

      try {
        await resumeEntryFromReservation({
          conditionId: row.condition_id,
          assetId: row.asset_id,
          mode: row.mode,
          signalId: row.order_signal_id,
          logicalKey: `janitor:${row.position_id}`,
          reason,
          reservation: {
            reservationId: row.reservation_id,
            copiedPositionId: row.position_id,
            reservedNotionalPusd: Number(row.reserved_notional_pusd),
            expiresAt,
            orderSignalId: row.order_signal_id,
          },
          connectionManager: this.connectionManager,
          reservationService: this.reservationService,
          orderQueue,
          hasBuyExecution: () =>
            this.executionService.hasBuyForPosition(row.position_id),
          hasInFlightBuy: () =>
            this.executionService.hasInFlightBuy(row.position_id),
          releaseOnSkip: false,
        });
        log.warn(
          {
            positionId: row.position_id,
            orderSignalId: row.order_signal_id,
            reason,
          },
          're-enqueued orphan pending entry',
        );
      } catch (err) {
        log.error(
          { err, positionId: row.position_id, reason },
          'failed to re-enqueue orphan pending entry',
        );
      }
    }
  }

  private async loadOrphanPendingEntries(): Promise<OrphanRow[]> {
    return this.ds.query(
      `
      SELECT p.id AS position_id,
             r.order_signal_id,
             r.id AS reservation_id,
             r.reserved_notional_pusd,
             r.expires_at,
             p.condition_id,
             p.asset_id,
             p.mode,
             p.reason
      FROM copied_positions p
      INNER JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.status = 'pending'
        AND p.reason IN ('ALGO_OPEN', 'WEATHER_OPEN')
        AND r.expires_at >= NOW()
        AND r.created_at < NOW() - INTERVAL '15 seconds'
        AND NOT EXISTS (
          SELECT 1 FROM executions e
          WHERE e.copied_position_id = p.id AND e.side = 'BUY'
        )
      ORDER BY p.id
      `,
    );
  }

  start(intervalMs = 30_000): NodeJS.Timeout {
    return safeInterval(() => this.run(), intervalMs, 'pending-entry-janitor');
  }
}

export const PENDING_ENTRY_JANITOR_QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;
export const PENDING_WEATHER_ENTRY_JANITOR_QUEUE = WORKER_QUEUES.WEATHER_ORDER_SIGNALS;
