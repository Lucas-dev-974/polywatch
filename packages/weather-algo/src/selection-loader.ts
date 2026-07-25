import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  safeInterval,
  type WeatherMarketSelection,
  type WeatherMarketSelectionService,
} from '@polywatch/core';

const CONFIG_CHANGED_CHANNEL = 'config-changed';
const PERIODIC_REFRESH_MS = 60_000;

const log = pino({ name: 'weather-algo:selection-loader' });

/**
 * Keeps an in-memory snapshot of enabled weather market selections,
 * refreshed from the database.
 *
 * Refresh is triggered three ways:
 *   1. Explicit `load()` / `reload()` calls.
 *   2. Redis `config-changed` pub/sub messages.
 *   3. A 60s safety-net interval.
 */
export class WeatherSelectionLoader {
  private selections = new Map<string, WeatherMarketSelection>();
  private periodicTimer: NodeJS.Timeout | null = null;
  private subscribed = false;
  private onConfigChangedCallback?: () => void | Promise<void>;

  constructor(
    private readonly service: WeatherMarketSelectionService,
    private readonly redisSub: Redis,
  ) {}

  onConfigChanged(cb: () => void | Promise<void>): void {
    this.onConfigChangedCallback = cb;
  }

  async load(): Promise<void> {
    const entries = await this.service.loadAllEnabled();
    const next = new Map<string, WeatherMarketSelection>();
    for (const entry of entries) {
      next.set(entry.conditionId, entry);
    }
    this.selections = next;
    log.info(
      { count: this.selections.size },
      'loaded enabled weather market selections',
    );
  }

  async reload(): Promise<void> {
    try {
      const entries = await this.service.loadAllEnabled();
      const next = new Map<string, WeatherMarketSelection>();
      for (const entry of entries) {
        next.set(entry.conditionId, entry);
      }
      this.selections = next;
      log.info(
        { count: this.selections.size },
        'reloaded enabled weather market selections',
      );
    } catch (err) {
      log.error(
        { err },
        'failed to reload weather market selections — keeping stale snapshot',
      );
    }

    if (this.onConfigChangedCallback) {
      try {
        await this.onConfigChangedCallback();
      } catch (err) {
        log.error({ err }, 'config-changed callback failed');
      }
    }
  }

  getActiveSelections(): WeatherMarketSelection[] {
    return Array.from(this.selections.values());
  }

  isSelectionActive(conditionId: string): boolean {
    return this.selections.has(conditionId);
  }

  subscribeToConfigChanges(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    this.redisSub.subscribe(CONFIG_CHANGED_CHANNEL, (err) => {
      if (err) {
        log.error({ err }, 'failed to subscribe to config-changed channel');
        this.subscribed = false;
      }
    });

    this.redisSub.on('message', (channel: string) => {
      if (channel !== CONFIG_CHANGED_CHANNEL) return;
      log.info('config-changed received — reloading weather market selections');
      void this.reload();
    });
  }

  startPeriodicRefresh(): NodeJS.Timeout {
    if (this.periodicTimer) return this.periodicTimer;
    this.periodicTimer = safeInterval(
      () => this.reload(),
      PERIODIC_REFRESH_MS,
      'weather-selection-loader:periodic-refresh',
    );
    return this.periodicTimer;
  }

  async stop(): Promise<void> {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.subscribed) {
      try {
        await this.redisSub.unsubscribe(CONFIG_CHANGED_CHANNEL);
      } catch (err) {
        log.warn({ err }, 'failed to unsubscribe from config-changed channel');
      }
      this.subscribed = false;
    }
    this.selections.clear();
  }
}
