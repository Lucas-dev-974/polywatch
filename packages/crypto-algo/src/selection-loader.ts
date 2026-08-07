import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  safeInterval,
  type AlgoMarketSelectionService,
  type AlgoMarketSelection,
} from '@polywatch/core';

const CONFIG_CHANGED_CHANNEL = 'config-changed';
const PERIODIC_REFRESH_MS = 60_000;

const log = pino({ name: 'crypto-algo:selection-loader' });

/**
 * Keeps an in-memory snapshot of enabled algo market selections, refreshed
 * from the database via {@link AlgoMarketSelectionService.loadAllEnabled}.
 *
 * Refresh is triggered three ways:
 *   1. Explicit `load()` / `reload()` calls.
 *   2. Redis `config-changed` pub/sub messages (low latency).
 *   3. A 60s `safeInterval` safety net in case pub/sub messages are missed.
 */
export class SelectionLoader {
  private selections = new Map<string, AlgoMarketSelection>();
  private periodicTimer: NodeJS.Timeout | null = null;
  private subscribed = false;
  /** Serializes concurrent reload() calls (config-changed + periodic refresh). */
  private reloadChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly service: AlgoMarketSelectionService,
    private readonly redisSub: Redis,
  ) {}

  /** Load all enabled selections from the database into memory. */
  async load(): Promise<void> {
    const entries = await this.service.loadAllEnabled();
    const next = new Map<string, AlgoMarketSelection>();
    for (const entry of entries) {
      next.set(entry.conditionId, entry);
    }
    this.selections = next;
    log.info({ count: this.selections.size }, 'loaded enabled algo market selections');
  }

  /**
   * Runtime reload — silent on failure (service stays alive with stale selections).
   * Concurrent calls are serialized via an internal promise chain to avoid
   * overlapping DB reads and racing snapshot swaps.
   */
  reload(): Promise<void> {
    this.reloadChain = this.reloadChain.then(() => this.doReload()).catch((err) => {
      log.error({ err }, 'reload chain swallowed error');
    });
    return this.reloadChain;
  }

  private async doReload(): Promise<void> {
    try {
      const entries = await this.service.loadAllEnabled();
      const next = new Map<string, AlgoMarketSelection>();
      for (const entry of entries) {
        next.set(entry.conditionId, entry);
      }
      this.selections = next;
      log.info({ count: this.selections.size }, 'reloaded enabled algo market selections');
    } catch (err) {
      log.error({ err }, 'failed to reload algo market selections — keeping stale snapshot');
    }
  }

  /** Returns an array of all active (enabled) selections held in memory. */
  getActiveSelections(): AlgoMarketSelection[] {
    return Array.from(this.selections.values());
  }

  /** Returns true when `conditionId` is present in the in-memory map. */
  isSelectionActive(conditionId: string): boolean {
    return this.selections.has(conditionId);
  }

  /**
   * Subscribe to the Redis `config-changed` channel and reload on every
   * message. Safe to call once; repeated calls are no-ops.
   */
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
      log.info('config-changed received — reloading algo market selections');
      void this.reload();
    });
  }

  /**
   * Start a 60s safety-net interval that calls {@link reload} in case any
   * `config-changed` pub/sub messages were missed. Returns the timer so
   * callers may clear it independently if needed.
   */
  startPeriodicRefresh(): NodeJS.Timeout {
    if (this.periodicTimer) return this.periodicTimer;
    this.periodicTimer = safeInterval(
      () => this.reload(),
      PERIODIC_REFRESH_MS,
      'selection-loader:periodic-refresh',
    );
    return this.periodicTimer;
  }

  /** Cleanup: stop the periodic timer and unsubscribe from Redis. */
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