import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
  RealArchiveService,
  RiskService,
} from '@polywatch/core';
import { fetchObservedWalletCash } from '../polymarket/observed-wallet-cash.js';
import { emitRealSnapshotCreated } from '../websocket.js';
import {
  recordSnapshotCreated,
  recordSnapshotCount,
  recordSnapshotPurge,
} from '../metrics.js';

const log = pino({ name: 'real-auto-snapshot' });

const TICK_MS = 30_000;

const LOOP_STATE_KEY = Symbol.for('polywatch.realAutoSnapshotLoop');

type LoopState = {
  intervalHandle: ReturnType<typeof setInterval> | null;
  tickRunning: boolean;
};

function getLoopState(): LoopState {
  const globalState = globalThis as typeof globalThis & {
    [LOOP_STATE_KEY]?: LoopState;
  };
  if (!globalState[LOOP_STATE_KEY]) {
    globalState[LOOP_STATE_KEY] = {
      intervalHandle: null,
      tickRunning: false,
    };
  }
  return globalState[LOOP_STATE_KEY];
}

export function stopRealAutoSnapshotLoop(): void {
  const state = getLoopState();
  if (state.intervalHandle != null) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
    log.info('real auto-snapshot loop stopped');
  }
}

export function startRealAutoSnapshotLoop(ds: DataSource): void {
  stopRealAutoSnapshotLoop();

  const archiveService = new RealArchiveService(ds);
  const riskService = new RiskService(ds);
  const state = getLoopState();

  state.intervalHandle = setInterval(() => {
    void runAutoSnapshotTick(ds, archiveService, riskService, state);
  }, TICK_MS);

  log.info({ tickMs: TICK_MS }, 'real auto-snapshot loop started');
}

async function runAutoSnapshotTick(
  ds: DataSource,
  archiveService: RealArchiveService,
  riskService: RiskService,
  state: LoopState,
): Promise<void> {
  if (state.tickRunning) return;
  state.tickRunning = true;

  try {
    const risk = await riskService.getConfig();
    if (!risk.realAutoSnapshotEnabled) return;

    const observedCash = await fetchObservedWalletCash(ds);
    if (observedCash == null) {
      log.debug('wallet cash unavailable — skipping real auto snapshot');
      return;
    }

    const summary = await archiveService.createAutoSnapshotIfDue({
      intervalSec: risk.realAutoSnapshotIntervalSeconds,
      minIntervalSec: MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
      observedCash,
    });
    if (summary) {
      emitRealSnapshotCreated();
      recordSnapshotCreated('auto', 'real');
      recordSnapshotCount(await archiveService.countSnapshots(), 'real');
      log.info(
        { snapshotId: summary.id, intervalSec: risk.realAutoSnapshotIntervalSeconds },
        'automatic real snapshot created',
      );
    }

    if (risk.realSnapshotMaxCount != null || risk.realSnapshotRetentionDays != null) {
      const pruned = await archiveService.pruneSnapshots({
        maxCount: risk.realSnapshotMaxCount,
        retentionDays: risk.realSnapshotRetentionDays,
      });
      if (pruned > 0) {
        log.info({ pruned }, 'old real snapshots pruned by retention policy');
        recordSnapshotPurge(pruned, 'real');
        recordSnapshotCount(await archiveService.countSnapshots(), 'real');
      }
    }
  } catch (err) {
    log.warn({ err }, 'automatic real snapshot failed');
  } finally {
    state.tickRunning = false;
  }
}
