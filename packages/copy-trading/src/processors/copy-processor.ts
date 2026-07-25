import type { DataSource } from 'typeorm';
import {
  MarketService,
  MoveEventService,
  ReservationService,
  RiskService,
  SimulationService,
  WatchlistService,
  type IPolymarketConnectionManager,
  type MoveEventDto,
  type MoveSkipReasonsUpdate,
  type OrderSignal,
  type RedisQueue,
  type TradingMode,
} from '@polywatch/core';
import { notifyMoveEventsChanged } from '../notify/backend-notify.js';
import { registerPendingMoveAsset } from '../polymarket/pending-move-assets.js';
import { runCopyEntryPipeline } from './copy/copy-entry-pipeline.js';
import { runCopyExitPipeline } from './copy/copy-exit-pipeline.js';
import {
  canHandleEntry,
  evaluateCopyMoveGate,
  passesMarketTagFilter,
  resolveCopyModesWithReasons,
} from './copy/copy-risk-gate.js';
import pino from 'pino';

const log = pino({ name: 'copy-processor' });

export class CopyProcessor {
  private reservationService: ReservationService;
  private watchlistService: WatchlistService;
  private moveEventService: MoveEventService;
  private riskService: RiskService;
  private simulationService: SimulationService;
  private marketService: MarketService;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: IPolymarketConnectionManager,
    private readonly orderQueue: RedisQueue<OrderSignal>,
  ) {
    this.reservationService = new ReservationService(ds);
    this.watchlistService = new WatchlistService(ds);
    this.moveEventService = new MoveEventService(ds);
    this.riskService = new RiskService(ds);
    this.simulationService = new SimulationService(ds);
    this.marketService = new MarketService(ds);
  }

  async handle(move: MoveEventDto): Promise<void> {
    const entry = await this.watchlistService.findByTraderAddress(
      move.traderAddress,
    );
    if (!entry) {
      await this.moveEventService.markProcessedWithReasons([move.id], {
        sim: 'Trader absent de la watchlist',
        real: 'Trader absent de la watchlist',
      });
      return;
    }

    const risk = await this.riskService.getConfig();
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, risk);
    const skipReasons: MoveSkipReasonsUpdate = {};
    const recordSkip = (mode: TradingMode, reason: string) => {
      if (!skipReasons[mode]) skipReasons[mode] = reason;
    };

    if (skippedRealReason) {
      recordSkip('real', skippedRealReason);
    }

    for (const mode of modes) {
      const modeResult = await this.processMode(move, entry, mode, risk);
      if (modeResult.kind === 'skip') {
        recordSkip(mode, modeResult.reason);
      }
    }

    await this.moveEventService.markProcessedWithReasons([move.id], skipReasons);
    void notifyMoveEventsChanged();
  }

  private async processMode(
    move: MoveEventDto,
    entry: NonNullable<Awaited<ReturnType<WatchlistService['findByTraderAddress']>>>,
    mode: TradingMode,
    risk: Awaited<ReturnType<RiskService['getConfig']>>,
  ): Promise<{ kind: 'ok' } | { kind: 'skip'; reason: string }> {
    const isEntry = move.type === 'OPENED' || move.type === 'INCREASED';
    const isExit = move.type === 'DECREASED' || move.type === 'CLOSED';

    const gate = await evaluateCopyMoveGate(
      this.ds,
      move,
      entry,
      mode,
      risk,
      this.riskService,
    );
    if (!gate.allowed) {
      return { kind: 'skip', reason: gate.reason };
    }

    if (isEntry) {
      return this.processEntry(move, entry, mode, risk);
    }
    if (isExit) {
      return this.processExit(move, entry, mode);
    }
    return { kind: 'skip', reason: 'Type de mouvement non pris en charge' };
  }

  private async processEntry(
    move: MoveEventDto,
    entry: NonNullable<Awaited<ReturnType<WatchlistService['findByTraderAddress']>>>,
    mode: TradingMode,
    risk: Awaited<ReturnType<RiskService['getConfig']>>,
  ): Promise<{ kind: 'ok' } | { kind: 'skip'; reason: string }> {
    if (!(await passesMarketTagFilter(this.marketService, move.conditionId, risk, mode))) {
      return { kind: 'skip', reason: 'Tag marché non autorisé' };
    }
    const entryCheck = await canHandleEntry(this.ds, move, entry, mode, risk);
    if (!entryCheck.ok) {
      return { kind: 'skip', reason: entryCheck.reason };
    }

    registerPendingMoveAsset(move.assetId);
    try {
      const entrySkip = await runCopyEntryPipeline({
        move,
        entry,
        mode,
        risk,
        connectionManager: this.connectionManager,
        marketService: this.marketService,
        reservationService: this.reservationService,
        simulationService: this.simulationService,
        orderQueue: this.orderQueue,
        ds: this.ds,
      });
      if (entrySkip) {
        return { kind: 'skip', reason: entrySkip };
      }
    } catch (err) {
      // Transient error (e.g. enqueue after reservation) — propagate so the
      // move event is NOT marked processed and the queue retries.
      log.warn(
        { err, moveId: move.id, mode },
        'entry pipeline threw — propagating for retry',
      );
      throw err;
    }
    return { kind: 'ok' };
  }

  private async processExit(
    move: MoveEventDto,
    entry: NonNullable<Awaited<ReturnType<WatchlistService['findByTraderAddress']>>>,
    mode: TradingMode,
  ): Promise<{ kind: 'ok' } | { kind: 'skip'; reason: string }> {
    const exitSkip = await runCopyExitPipeline({
      ds: this.ds,
      move,
      entry,
      mode,
      connectionManager: this.connectionManager,
      orderQueue: this.orderQueue,
    });
    if (exitSkip) {
      return { kind: 'skip', reason: exitSkip };
    }
    return { kind: 'ok' };
  }
}
