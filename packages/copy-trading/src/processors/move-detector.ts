import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  DEFAULT_MOVE_DETECTOR_INTERVAL_MS,
  MAX_MOVE_DETECTOR_INTERVAL_MS,
  MIN_MOVE_DETECTOR_INTERVAL_MS,
  MoveEventService,
  PollCycleService,
  resolveOutcomeLabel,
  CopyConfigService,
  TraderSnapshot,
  WatchlistService,
  type MoveEventDto,
  type RedisQueue,
} from '@polywatch/core';
import { fetchTraderPositions } from '../polymarket/api-client.js';
import { CircuitBreaker, CircuitBreakerOpenError, type CircuitState } from '../polymarket/circuit-breaker.js';
import { notifyMoveEventsChanged } from '../notify/backend-notify.js';
import { postBackendJson } from '../backend-client.js';

const log = pino({ name: 'move-detector' });

function reportCircuitBreakerState(name: string, state: CircuitState): void {
  void postBackendJson('/api/internal/metrics/circuit-breaker', { name, state }).catch(
    (err) => log.warn({ err, name, state }, 'failed to report circuit breaker state'),
  );
}

const dataApiBreaker = new CircuitBreaker({
  name: 'PolymarketDataAPI',
  failureThreshold: 5,
  cooldownMs: 30_000,
  onStateChange: (state) => reportCircuitBreakerState('PolymarketDataAPI', state),
});

export class MoveDetector {
  private firstPollPending = new Map<string, boolean>();
  private pollService: PollCycleService;
  private moveEventService: MoveEventService;
  private watchlistService: WatchlistService;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = DEFAULT_MOVE_DETECTOR_INTERVAL_MS;
  private stopped = false;

  public cyclesCompleted = 0;
  public lastCycleLatencyMs = 0;

  constructor(
    private readonly ds: DataSource,
    private readonly moveQueue: RedisQueue<MoveEventDto>,
    private readonly copyConfigService: CopyConfigService,
  ) {
    this.pollService = new PollCycleService(ds);
    this.moveEventService = new MoveEventService(ds);
    this.watchlistService = new WatchlistService(ds);
  }

  markFirstPollPending(traderAddress: string): void {
    this.firstPollPending.set(traderAddress.toLowerCase(), true);
  }

  /** Only traders without a stored snapshot get a reconcile-only first poll. */
  async markFirstPollPendingForNewTraders(traderAddresses: string[]): Promise<void> {
    const snapshotRepo = this.ds.getRepository(TraderSnapshot);
    for (const raw of traderAddresses) {
      const addr = raw.toLowerCase();
      const count = await snapshotRepo.count({ where: { traderAddress: addr } });
      if (count === 0) {
        this.markFirstPollPending(addr);
      }
    }
  }

  async recoverOrphanMoves(): Promise<void> {
    const orphans = await this.moveEventService.loadUnprocessed();
    for (const event of orphans) {
      await this.moveQueue.enqueue({
        id: event.id,
        traderAddress: event.traderAddress,
        conditionId: event.conditionId,
        assetId: event.assetId,
        outcome: resolveOutcomeLabel(event.outcome),
        type: event.eventType as MoveEventDto['type'],
        traderSize: event.traderSize,
        traderAvgPrice: event.traderAvgPrice ?? 0,
        previousTraderSize: event.previousTraderSize,
        detectedAt: event.detectedAt,
        marketMeta: { title: '', endDate: '', negativeRisk: false },
      });
    }
    if (orphans.length > 0) {
      log.info({ count: orphans.length }, 'recovered orphan move events');
    }

    // Safety net: retry move events that were marked processed but whose
    // copied position is still pending with no active reservation. This
    // can happen after a crash between reservation + markProcessed and
    // the BUY execution finalization.
    const stale = await this.moveEventService.loadProcessedWithStalePending();
    if (stale.length > 0) {
      const ids = stale.map((m) => m.id);
      log.warn({ count: stale.length, ids }, 'recovering stale processed moves with orphan pending positions');
      await this.moveEventService.resetProcessed(ids);
      for (const event of stale) {
        await this.moveQueue.enqueue({
          id: event.id,
          traderAddress: event.traderAddress,
          conditionId: event.conditionId,
          assetId: event.assetId,
          outcome: resolveOutcomeLabel(event.outcome),
          type: event.eventType as MoveEventDto['type'],
          traderSize: event.traderSize,
          traderAvgPrice: event.traderAvgPrice ?? 0,
          previousTraderSize: event.previousTraderSize,
          detectedAt: event.detectedAt,
          marketMeta: { title: '', endDate: '', negativeRisk: false },
        });
      }
    }
  }

  private async pollTrader(traderAddress: string): Promise<MoveEventDto[]> {
    try {
      const { positions: snapshot, truncated } = await dataApiBreaker.call(() =>
        fetchTraderPositions(traderAddress),
      );
      if (truncated) {
        log.warn(
          { trader: traderAddress },
          'positions poll truncated at Data API page limit — skipping absent CLOSED inference',
        );
      }
      const addr = traderAddress.toLowerCase();
      const isFirst = this.firstPollPending.get(addr) ?? false;
      const pollOptions = { snapshotTruncated: truncated };

      const moves = isFirst
        ? await this.pollService.reconcile(addr, snapshot, pollOptions)
        : await this.pollService.runPollCycle(addr, snapshot, pollOptions);

      if (isFirst && !truncated) {
        this.firstPollPending.delete(addr);
      }

      // Backfill avgPrice for recent OPENED events that don't have it yet.
      // The Data API often omits avgPrice for newly opened positions; we fill it
      // from the consolidated snapshot on the next poll cycle.
      try {
        const backfilled = await this.moveEventService.backfillRecentAvgPrice(
          addr,
          snapshot,
        );
        if (backfilled > 0) {
          log.info(
            { trader: addr, count: backfilled },
            'backfilled avgPrice for recent OPENED events',
          );
        }
      } catch (err) {
        log.warn({ err, trader: addr }, 'failed to backfill avgPrice — continuing');
      }

      return moves;
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        log.warn({ trader: traderAddress }, 'positions poll skipped — circuit breaker open');
      } else {
        log.error({ err, trader: traderAddress }, 'positions poll failed');
      }
      return [];
    }
  }

  private async enqueueMoves(moves: MoveEventDto[]): Promise<void> {
    for (const move of moves) {
      await this.moveQueue.enqueue(move);
      log.info({ moveId: move.id, type: move.type }, 'move enqueued');
    }
    if (moves.length > 0) {
      void notifyMoveEventsChanged();
    }
  }

  async pollAll(): Promise<{ moves: number; traders: number; skipped: number }> {
    const watchlist = await this.watchlistService.loadAll();
    const traders = watchlist.filter(
      (e) => e.active || e.simEnabled || e.realEnabled,
    );
    const skipped = watchlist.length - traders.length;
    if (traders.length === 0) return { moves: 0, traders: 0, skipped };

    const results = await Promise.allSettled(
      traders.map(async (entry) => {
        const moves = await this.pollTrader(entry.traderAddress);
        await this.enqueueMoves(moves);
        return moves;
      }),
    );

    let totalMoves = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalMoves += r.value.length;
      }
    }

    return { moves: totalMoves, traders: traders.length, skipped };
  }

  private async runCycle(): Promise<void> {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);

    let enabled: boolean;
    try {
      const cfg = await this.copyConfigService.getConfig();
      enabled = cfg.simCopyTradingEnabled || cfg.realCopyTradingEnabled;
    } catch (err) {
      log.error({ err }, 'failed to read copy-trading enabled state — skipping cycle');
      enabled = false;
    }

    if (!enabled) {
      log.info('copy trading disabled — stopping surveillance loop');
      this.stopPolling();
      return;
    }

    const startedAt = performance.now();
    try {
      const { moves, traders, skipped } = await this.pollAll();
      this.cyclesCompleted++;
      log.info(
        { moves, traders: traders + skipped, cyclesCompleted: this.cyclesCompleted },
        'poll cycle complete',
      );
    } catch (err) {
      log.error({ err }, 'poll cycle failed');
    }

    if (this.stopped) return;

    const elapsed = performance.now() - startedAt;
    this.lastCycleLatencyMs = elapsed;
    const delay = Math.max(0, this.intervalMs - elapsed);

    if (elapsed > this.intervalMs) {
      log.warn(
        { elapsedMs: elapsed, delayMs: delay, intervalMs: this.intervalMs },
        'poll cycle exceeded target interval — cycle may lag',
      );
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delay);
  }

  startPolling(): void {
    this.stopped = false;
    this.timer = setTimeout(() => {
      void this.runCycle();
    }, 0);
  }

  setIntervalMs(intervalMs: number): void {
    const clamped = Math.min(
      MAX_MOVE_DETECTOR_INTERVAL_MS,
      Math.max(MIN_MOVE_DETECTOR_INTERVAL_MS, Math.round(intervalMs)),
    );
    if (clamped === this.intervalMs) return;
    log.info({ intervalMs: clamped, previousMs: this.intervalMs }, 'move detector interval updated');
    this.intervalMs = clamped;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  stopPolling(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return !this.stopped && this.timer != null;
  }
}
