import type { DataSource } from 'typeorm';
import {
  CopiedPosition,
  buildCloseOrderSignal,
  RiskService,
  type OrderSignal,
  type TotalCloseReason,
  type TradingMode,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import type { RedisQueue } from '../../queue/redis-queue.js';
import { getEffectiveBidVwap } from './position-evaluator.js';

const log = pino({ name: 'kill-switch-monitor' });

export type KillSwitchState = Map<
  TradingMode,
  { triggered: boolean; action: string }
>;

export class KillSwitchMonitor {
  private lastKillSwitchCheck = 0;
  readonly state: KillSwitchState = new Map();

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly closeQueue: RedisQueue<OrderSignal>,
    private readonly riskService: RiskService,
  ) {}

  getLastCheckAt(): number {
    return this.lastKillSwitchCheck;
  }

  markChecked(): void {
    this.lastKillSwitchCheck = Date.now();
  }

  shouldCheck(now: number, intervalMs: number): boolean {
    return now - this.lastKillSwitchCheck >= intervalMs;
  }

  async evaluate(): Promise<void> {
    const modes: TradingMode[] = ['sim', 'real'];
    for (const mode of modes) {
      try {
        const result = await this.riskService.checkKillSwitch(mode);
        this.state.set(mode, {
          triggered: result.killSwitchTriggered,
          action: result.action,
        });

        if (result.killSwitchTriggered && result.action === 'force_close_all') {
          log.warn({ mode }, 'kill switch force_close_all triggered');
          await this.forceCloseAllPositions(mode);
        }
      } catch (err) {
        log.warn({ err, mode }, 'kill switch check failed');
      }
    }
    this.markChecked();
  }

  private async forceCloseAllPositions(mode: TradingMode): Promise<void> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: { status: 'open', mode },
    });

    for (const pos of positions) {
      const bookPrices = this.connectionManager.getExecutablePrices(
        pos.assetId,
        pos.quantity,
      );
      const bidVwap = getEffectiveBidVwap(pos, bookPrices.executableBidVwap);

      if (bidVwap <= 0) {
        log.warn(
          { positionId: pos.id },
          'force-close skipped — no bid fallback available',
        );
        continue;
      }

      await this.closeQueue.enqueue(
        buildCloseOrderSignal({
          pos: {
            id: pos.id,
            mode: pos.mode,
            conditionId: pos.conditionId,
            assetId: pos.assetId,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            executableBidVwap: pos.executableBidVwap,
            closingAttemptSeq: pos.closingAttemptSeq + 1,
          },
          reason: 'KILL_SWITCH' as TotalCloseReason,
          bidVwap,
        }),
      );

      log.warn({ positionId: pos.id, mode }, 'force-close enqueued');
    }
  }
}
