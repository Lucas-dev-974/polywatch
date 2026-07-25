import type { DataSource } from 'typeorm';
import { MarketResolutionService } from '@polywatch/core';
import pino from 'pino';
import { safeInterval } from '../helpers.js';
import { countStaleUnresolvedWinningTokenMarkets } from './market-resolution-monitoring.js';

const log = pino({ name: 'market-resolution' });

/** Worker loop — delegates resolution detection to core MarketResolutionService. */
export class MarketResolutionWatcher {
  private resolutionService: MarketResolutionService;

  constructor(private readonly ds: DataSource) {
    this.resolutionService = new MarketResolutionService(ds);
  }

  async processAll(): Promise<void> {
    const marked = await this.resolutionService.processResolvablePositions();
    for (const result of marked) {
      log.info(result, 'position marked pending_resolution');
    }

    const staleUnresolved = await countStaleUnresolvedWinningTokenMarkets(this.ds);
    if (staleUnresolved > 0) {
      log.warn(
        { count: staleUnresolved },
        'markets with winningTokenId but unresolved for >24h',
      );
    }
  }

  startLoop(intervalMs = 30_000): NodeJS.Timeout {
    return safeInterval(() => this.processAll(), intervalMs, 'market-resolution-watcher');
  }
}
