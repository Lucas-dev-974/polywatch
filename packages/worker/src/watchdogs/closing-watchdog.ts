import type { DataSource } from 'typeorm';
import { CopiedPositionService, ExecutionService } from '@polywatch/core';
import pino from 'pino';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'closing-watchdog' });

export class ClosingWatchdog {
  private positionService: CopiedPositionService;
  private executionService: ExecutionService;

  constructor(private readonly ds: DataSource) {
    this.positionService = new CopiedPositionService(ds);
    this.executionService = new ExecutionService(ds);
  }

  async run(): Promise<void> {
    const stuck = await this.positionService.loadClosingStuck(3);
    for (const pos of stuck) {
      const cancelled = await this.executionService.failActiveForPosition(pos.id);
      if (cancelled > 0) {
        log.warn({ positionId: pos.id, cancelled }, 'cancelled in-flight executions');
      }
      log.warn({ positionId: pos.id }, 'closing stuck — marking failed');
      await this.positionService.markFailed(pos.id);
    }
  }

  start(intervalMs = 15_000): NodeJS.Timeout {
    return safeInterval(() => this.run(), intervalMs, 'closing-watchdog');
  }
}
