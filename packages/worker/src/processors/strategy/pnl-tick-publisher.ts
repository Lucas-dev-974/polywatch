import type { CopiedPosition } from '@polywatch/core';
import {
  CopiedPositionService,
  type LiquidityStatus,
  type PnlTick,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import { postBackendJson } from '../../backend-client.js';
import { PNL_TICK_THROTTLE_MS } from '../../constants.js';
import { computePnlSnapshot } from './position-evaluator.js';

const log = pino({ name: 'pnl-tick-publisher' });

export class PnlTickPublisher {
  private lastPnlTick = new Map<number, number>();

  constructor(
    private readonly positionService: CopiedPositionService,
    private readonly connectionManager: PolymarketConnectionManager,
  ) {}

  async pushTicks(ticks: PnlTick[]): Promise<void> {
    if (ticks.length === 0) return;
    try {
      await postBackendJson('/api/internal/pnl-ticks', { ticks });
    } catch (err) {
      log.warn({ err }, 'pnl tick push failed');
    }
  }

  shouldEmitTick(positionId: number, now: number): boolean {
    const lastTick = this.lastPnlTick.get(positionId) ?? 0;
    return now - lastTick >= PNL_TICK_THROTTLE_MS;
  }

  markTickEmitted(positionId: number, now: number): void {
    this.lastPnlTick.set(positionId, now);
  }

  async publishPositionPnl(
    pos: CopiedPosition,
    markPrice: number,
    liquidityStatus: LiquidityStatus,
    now: number,
    options: { updatePeakTracking: boolean },
  ): Promise<{
    tick: PnlTick | null;
    trigger: number;
    closure: number;
    peakClosure: number;
    peakBidVwap: number;
    unrealizedPnl: number;
  }> {
    const snap = computePnlSnapshot(markPrice, pos);
    const { trigger, closure, unrealizedPnl: unrl } = snap;

    const peakClosure = options.updatePeakTracking
      ? snap.peakClosure
      : (pos.peakClosurePnlPercent ?? closure);

    const peakBidVwap = options.updatePeakTracking
      ? Math.max(pos.peakBidVwap ?? markPrice, markPrice)
      : (pos.peakBidVwap ?? markPrice);

    let tick: PnlTick | null = null;
    if (this.shouldEmitTick(pos.id, now)) {
      tick = {
        copiedPositionId: pos.id,
        executableBidVwap: markPrice,
        triggerPnlPercent: trigger,
        closurePnlPercent: closure,
        unrealizedPnl: unrl,
        liquidityStatus,
        bookUpdatedAt: new Date(),
        bookConnectionHealthy: this.connectionManager.isBookConnectionHealthy(),
      };
      this.markTickEmitted(pos.id, now);
    }

    await this.positionService.updatePnlFields(pos.id, {
      executableBidVwap: markPrice,
      unrealizedPnl: unrl,
      ...(options.updatePeakTracking
        ? { peakClosurePnlPercent: peakClosure, peakBidVwap }
        : {}),
      liquidityStatus,
      bookUpdatedAt: new Date(),
    });

    return { tick, trigger, closure, peakClosure, peakBidVwap, unrealizedPnl: unrl };
  }
}
