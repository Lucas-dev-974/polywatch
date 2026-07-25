import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  CopiedPosition,
  ExecutionService,
  setAlgoEntryCooldown,
} from '@polywatch/core';
import pino from 'pino';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'placing-janitor' });

/** Sim-only: real placing orphans are reconciled via REST/WS, not the janitor. */
export class PlacingJanitor {
  private executionService: ExecutionService;

  constructor(
    private readonly ds: DataSource,
    private readonly redisCmd: Pick<Redis, 'set'>,
  ) {
    this.executionService = new ExecutionService(ds);
  }

  async run(): Promise<void> {
    const orphans = await this.executionService.loadOrphanPlacingSim();
    for (const exec of orphans) {
      log.warn(
        {
          orderSignalId: exec.orderSignalId,
          positionId: exec.copiedPositionId,
          side: exec.side,
          reason: exec.reason,
        },
        exec.side === 'BUY'
          ? 'orphan sim placing BUY — marking failed (stale pending or state left)'
          : 'orphan sim placing execution — marking failed (state left)',
      );
      await this.executionService.finalize({
        orderSignalId: exec.orderSignalId,
        status: 'failed',
        fillPrice: 0,
        fillQuantity: 0,
        fees: 0,
        error: 'placing_orphan',
      });
      await this.maybeSetAlgoEntryCooldown(exec);
    }
  }

  private async maybeSetAlgoEntryCooldown(exec: {
    side: string;
    reason: string | null;
    mode: string;
    copiedPositionId: number;
  }): Promise<void> {
    if (exec.side !== 'BUY' || exec.reason !== 'ALGO_OPEN' || exec.mode !== 'sim') {
      return;
    }

    const pos = await this.ds.getRepository(CopiedPosition).findOne({
      where: { id: exec.copiedPositionId },
    });
    if (!pos?.conditionId) return;

    await setAlgoEntryCooldown(
      this.redisCmd,
      pos.conditionId,
      exec.mode as 'sim' | 'real',
    );
  }

  start(intervalMs = 60_000): NodeJS.Timeout {
    return safeInterval(() => this.run(), intervalMs, 'placing-janitor');
  }
}
