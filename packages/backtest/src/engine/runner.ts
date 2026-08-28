import pino from 'pino';
import { VirtualClock } from './virtual-clock.js';
import {
  BacktestRunService,
  type BacktestExcludedReason,
  type BacktestPositionInput,
  type BacktestRunStats,
  type WeatherConfig,
} from '@polywatch/core';
import type { BacktestEvent } from './events.js';
import type { BacktestDomainAdapter } from '../adapters/backtest-domain-adapter.js';
import { computeStats, type EquitySample } from './stats.js';
import { Ledger, type ClosedLedgerPosition, type LedgerPosition } from './ledger.js';

const log = pino({ name: 'backtest:runner' });

/** Un tick exclu par le moteur (cycle de marché ou métrique non supportée). */
export interface BacktestExcludedTick {
  t: Date;
  reason: BacktestExcludedReason;
  city: string | null;
  conditionId: string;
  metric: string | null;
}

export interface RunContext {
  runId: number;
  clock: VirtualClock;
  ledger: Ledger;
  configSnapshot: WeatherConfig;
  fidelityWarnings: string[];
  /** Ticks book exclus par le moteur pendant le run. */
  excludedTicks: BacktestExcludedTick[];
  params: {
    slippageBps: number;
      maxConcurrentPositions: number;
      entryUsdc: number;
      capital: number;
      strategyId?: string;
      strategyEnv: 'sim' | 'real';
      fidelityMinutes?: number;
  };
  cancelRequested(): boolean;
}

export interface RunResult {
  runId: number;
  positionsCount: number;
  equitySamplesCount: number;
  stats: BacktestRunStats;
  fidelityWarnings: string[];
  excludedTicks: BacktestExcludedTick[];
  dataRangeFrom: Date | null;
  dataRangeTo: Date | null;
}

export interface RunSpec {
  runId: number;
  events: () => AsyncIterable<BacktestEvent>;
  /** Pre-count for progress bar (streaming mode). */
  estimateTotalEvents?: () => Promise<number>;
  /** Builds the domain adapter with access to the run context. */
  adapterFactory: (ctx: RunContext) => BacktestDomainAdapter;
  initialCapital: number;
  configSnapshot: WeatherConfig;
  slippageBps: number;
  maxConcurrentPositions: number;
  entryUsdc: number;
  strategyId?: string;
  strategyEnv: 'sim' | 'real';
  fidelityMinutes?: number;
  service: BacktestRunService;
  /** Cooperative abort: 'cancelled' (user) or 'timeout'. */
  getAbortReason?: () => 'cancelled' | 'timeout' | null;
}

const EQUITY_SAMPLE_INTERVAL_MS = 60_000;

function isClosedPosition(p: LedgerPosition | ClosedLedgerPosition): p is ClosedLedgerPosition {
  return 'exitAt' in p && 'pnl' in p;
}

function mapPositionForPersist(p: LedgerPosition | ClosedLedgerPosition): BacktestPositionInput {
  if (isClosedPosition(p)) {
    return {
      conditionId: p.conditionId,
      city: p.city,
      side: p.side,
      qty: p.qty,
      entryPrice: p.entryPrice,
      exitPrice: p.exitPrice,
      entryAt: p.entryAt,
      exitAt: p.exitAt,
      entryReason: p.entryReason,
      exitReason: p.exitReason,
      pnl: p.pnl,
      fees: p.fees,
      metaJson: JSON.stringify(p.meta),
    };
  }
  return {
    conditionId: p.conditionId,
    city: p.city,
    side: p.side,
    qty: p.qty,
    entryPrice: p.entryPrice,
    exitPrice: null,
    entryAt: p.entryAt,
    exitAt: null,
    entryReason: p.entryReason,
    exitReason: null,
    pnl: null,
    fees: p.fees,
    metaJson: JSON.stringify(p.meta),
  };
}

/**
 * Drives the replay event loop. Consumes merged events in timestamp order,
 * advances the virtual clock, delegates handling to the domain adapter, and
 * periodically persists progress + equity samples.
 */
export class BacktestRunner {
  async run(spec: RunSpec): Promise<RunResult> {
    const { service, runId, getAbortReason } = spec;
    await service.markStarted(runId);

    const clock = new VirtualClock();
    const ledger = new Ledger(spec.initialCapital);
    const fidelityWarnings: string[] = [];
    const excludedTicks: BacktestExcludedTick[] = [];
    const allEquitySamples: EquitySample[] = [];

    const ctx: RunContext = {
      runId,
      clock,
      ledger,
      configSnapshot: spec.configSnapshot,
      fidelityWarnings,
      excludedTicks,
      params: {
        slippageBps: spec.slippageBps,
        maxConcurrentPositions: spec.maxConcurrentPositions,
        entryUsdc: spec.entryUsdc,
        capital: spec.initialCapital,
        strategyId: spec.strategyId,
        strategyEnv: spec.strategyEnv,
        fidelityMinutes: spec.fidelityMinutes,
      },
      cancelRequested: () => (spec.getAbortReason ? spec.getAbortReason() != null : false),
    };
    const adapter = spec.adapterFactory(ctx);

    // Lance le comptage en parallèle pour ne pas bloquer le démarrage de la
    // boucle d'événements. Sans ça, la barre reste à 0% pendant les COUNT(*)
    // sur les tables weather (potentiellement longs).
    let totalEstimated = 0;
    const countPromise = spec.estimateTotalEvents
      ? spec
          .estimateTotalEvents()
          .then((n) => {
            totalEstimated = n;
            if (n === 0) {
              fidelityWarnings.push('no_events_in_range: Aucune donnée sur la plage demandée');
            }
            return n;
          })
          .catch((err) => {
            log.warn({ runId, err }, 'backtest: event count failed, progress will be approximate');
            return 0;
          })
      : Promise.resolve(0);

    let processed = 0;
    let lastSampleAt = -Infinity;
    let lastProgressAt = 0;
    let dataRangeFrom: Date | null = null;
    let dataRangeTo: Date | null = null;
    let pendingEquityFlush: EquitySample[] = [];
    // §5 : nombre de positions fermées au dernier échantillon — pour capturer
    // un point d'equity à chaque close (drawdown intra-minute).
    let lastClosedCount = 0;

    const recordEquitySample = (t: Date) => {
      const snapshot = ledger.equityAt(clock.now());
      const sample: EquitySample = {
        t,
        equity: snapshot.equity,
        cash: snapshot.cash,
        openPositions: snapshot.openPositions,
      };
      allEquitySamples.push(sample);
      pendingEquityFlush.push(sample);
    };

    const persistProgress = async (finalPct?: number) => {
      let pct: number;
      if (finalPct != null) {
        pct = finalPct;
      } else if (totalEstimated > 0) {
        pct = Math.min(99, Math.round((processed / totalEstimated) * 100));
      } else if (processed > 0) {
        // Comptage encore en cours : on borne à 5% pour signaler l'activité
        // sans donner l'impression que le run est presque terminé.
        pct = Math.min(5, Math.max(1, Math.round((processed / 10_000) * 5)));
      } else {
        pct = 0;
      }
      await service.updateProgress(runId, pct);
      if (pendingEquityFlush.length > 0) {
        await service.appendEquity(runId, pendingEquityFlush);
        pendingEquityFlush = [];
      }
    };

    const buildStats = (finalEquity: number): BacktestRunStats =>
      computeStats(ledger.closedPositions(), spec.initialCapital, finalEquity, allEquitySamples);

    const finishRun = async (
      status: 'cancelled' | 'completed' | 'timeout',
    ): Promise<RunResult> => {
      // §4 : résoudre les ghost positions même en interruption. Pour
      // 'completed', adapter.finish a déjà été appelé dans le corps principal.
      if (status !== 'completed') {
        await adapter.finish?.(ctx);
      }
      recordEquitySample(clock.now());
      await persistProgress(status === 'completed' ? 100 : undefined);

      const positions = ledger.allPositions();
      await service.appendPositions(runId, positions.map(mapPositionForPersist));
      await service.appendExcludedTicks(runId, excludedTicks);

      const finalSnapshot = ledger.equityAt(clock.now());
      const stats = buildStats(finalSnapshot.equity);

      if (status === 'cancelled') {
        await service.markCancelled(
          runId,
          stats,
          fidelityWarnings,
          dataRangeFrom,
          dataRangeTo,
        );
        log.info({ runId, positions: positions.length }, 'backtest run cancelled');
      } else if (status === 'timeout') {
        await service.markFailed(runId, 'timeout');
        log.info({ runId, positions: positions.length }, 'backtest run timed out');
      } else {
        await service.markCompleted(
          runId,
          stats,
          fidelityWarnings,
          dataRangeFrom,
          dataRangeTo,
        );
        log.info({ runId, positions: positions.length }, 'backtest run completed');
      }

      return {
        runId,
        positionsCount: positions.length,
        equitySamplesCount: allEquitySamples.length,
        stats,
        fidelityWarnings,
        excludedTicks,
        dataRangeFrom,
        dataRangeTo,
      };
    };

    for await (const event of spec.events()) {
      const abort = getAbortReason?.() ?? null;
      if (abort === 'timeout') {
        return finishRun('timeout');
      }
      if (abort === 'cancelled') {
        return finishRun('cancelled');
      }

      clock.advanceTo(event.at);
      await adapter.handle(event, ctx);
      processed++;

      // §5 : échantillon d'équité à chaque close de position pour capturer
      // les drawdowns intra-minute (en plus de l'échantillon 60s).
      const closedCount = ledger.closedPositions().length;
      if (closedCount > lastClosedCount) {
        lastClosedCount = closedCount;
        recordEquitySample(clock.now());
        lastSampleAt = event.at.getTime();
      }

      if (dataRangeFrom === null) dataRangeFrom = event.at;
      dataRangeTo = event.at;

      if (event.at.getTime() - lastSampleAt >= EQUITY_SAMPLE_INTERVAL_MS) {
        lastSampleAt = event.at.getTime();
        recordEquitySample(clock.now());
      }

      const now = Date.now();
      if (now - lastProgressAt >= 2000) {
        lastProgressAt = now;
        await persistProgress();
      }

      if (processed % 5000 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // S'assurer que le comptage est résolu avant de finaliser (pour que le
    // progressPct final soit correct).
    await countPromise;

    // §7 : check d'abort final après épuisement des événements. Sans ce check,
    // un cancel/timeout demandé pendant le dernier événement terminerait le run
    // en 'completed' alors qu'un abort était en attente.
    const finalAbort = getAbortReason?.() ?? null;
    if (finalAbort === 'timeout') {
      return finishRun('timeout');
    }
    if (finalAbort === 'cancelled') {
      return finishRun('cancelled');
    }

    await adapter.finish?.(ctx);

    return finishRun('completed');
  }
}
