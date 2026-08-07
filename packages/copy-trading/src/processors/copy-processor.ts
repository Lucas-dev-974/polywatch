import type { DataSource } from 'typeorm';
import {
  MarketService,
  MoveEventService,
  ReservationService,
  CopyConfigService,
  GlobalConfigService,
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
  private copyConfigService: CopyConfigService;
  private globalConfigService: GlobalConfigService;
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
    this.copyConfigService = new CopyConfigService(ds);
    this.globalConfigService = new GlobalConfigService(ds);
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

    const existing = await this.moveEventService.findById(move.id);
    const simSessionReset = existing?.skipReasons?.sim === 'session_reset';

    const [copyConfig, globalConfig] = await Promise.all([
      this.copyConfigService.getConfig(),
      this.globalConfigService.getConfig(),
    ]);
    let { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, copyConfig, globalConfig);
    const skipReasons: MoveSkipReasonsUpdate = {};
    if (simSessionReset) {
      modes = modes.filter((m) => m !== 'sim');
      skipReasons.sim = existing?.skipReasons?.sim ?? 'session_reset';
    }
    const recordSkip = (mode: TradingMode, reason: string) => {
      if (!skipReasons[mode]) skipReasons[mode] = reason;
    };

    if (skippedRealReason) {
      recordSkip('real', skippedRealReason);
    }

    let modeThrew = false;
    for (const mode of modes) {
      try {
        const modeResult = await this.processMode(
          move,
          entry,
          mode,
          copyConfig,
          globalConfig,
        );
        if (modeResult.kind === 'skip') {
          recordSkip(mode, modeResult.reason);
        }
      } catch (err) {
        modeThrew = true;
        // Isolate modes: a sim failure must not block real (and vice versa).
        log.error(
          { err, moveId: move.id, mode },
          'copy processMode failed — continuing with remaining modes',
        );
        recordSkip(mode, 'process_mode_error');
      }
    }

    if (modeThrew) {
      // Leave move unprocessed so Redis retries the job (idempotent per mode).
      throw new Error(`copy_process_mode_error:${move.id}`);
    }

    await this.moveEventService.markProcessedWithReasons([move.id], skipReasons);
    void notifyMoveEventsChanged();
  }

  private async processMode(
    move: MoveEventDto,
    entry: NonNullable<Awaited<ReturnType<WatchlistService['findByTraderAddress']>>>,
    mode: TradingMode,
    copyConfig: Awaited<ReturnType<CopyConfigService['getConfig']>>,
    globalConfig: Awaited<ReturnType<GlobalConfigService['getConfig']>>,
  ): Promise<{ kind: 'ok' } | { kind: 'skip'; reason: string }> {
    const isEntry = move.type === 'OPENED' || move.type === 'INCREASED';
    const isExit = move.type === 'DECREASED' || move.type === 'CLOSED';

    const gate = await evaluateCopyMoveGate(
      this.ds,
      move,
      entry,
      mode,
      copyConfig,
      globalConfig,
    );
    if (!gate.allowed) {
      return { kind: 'skip', reason: gate.reason };
    }

    if (isEntry) {
      return this.processEntry(move, entry, mode, copyConfig, globalConfig);
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
    copyConfig: Awaited<ReturnType<CopyConfigService['getConfig']>>,
    globalConfig: Awaited<ReturnType<GlobalConfigService['getConfig']>>,
  ): Promise<{ kind: 'ok' } | { kind: 'skip'; reason: string }> {
    if (!(await passesMarketTagFilter(this.marketService, move.conditionId, copyConfig, mode))) {
      return { kind: 'skip', reason: 'Tag marché non autorisé' };
    }
    const entryCheck = await canHandleEntry(this.ds, move, entry, mode, copyConfig, globalConfig);
    if (!entryCheck.ok) {
      return { kind: 'skip', reason: entryCheck.reason };
    }

    registerPendingMoveAsset(move.assetId);
    try {
      const entrySkip = await runCopyEntryPipeline({
        move,
        entry,
        mode,
        copyConfig,
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
