import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
  RiskService,
  SimulationArchiveService,
} from '@polywatch/core';
import { emitSimulationSnapshotCreated } from '../websocket.js';
import {
  recordSnapshotCreated,
  recordSnapshotCount,
  recordSnapshotPurge,
} from '../metrics.js';

const log = pino({ name: 'sim-auto-snapshot' });

/** How often the loop checks whether a new auto snapshot is due. */
const TICK_MS = 30_000;

const LOOP_STATE_KEY = Symbol.for('polywatch.simAutoSnapshotLoop');

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

export { MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS };

export function stopSimAutoSnapshotLoop(): void {
  const state = getLoopState();
  if (state.intervalHandle != null) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
    log.info('simulation auto-snapshot loop stopped');
  }
}

export function startSimAutoSnapshotLoop(ds: DataSource): void {
  stopSimAutoSnapshotLoop();

  const archiveService = new SimulationArchiveService(ds);
  const riskService = new RiskService(ds);
  const state = getLoopState();

  state.intervalHandle = setInterval(() => {
    void runAutoSnapshotTick(archiveService, riskService, state);
  }, TICK_MS);

  log.info({ tickMs: TICK_MS }, 'simulation auto-snapshot loop started');
}

async function runAutoSnapshotTick(
  archiveService: SimulationArchiveService,
  riskService: RiskService,
  state: LoopState,
): Promise<void> {
  if (state.tickRunning) return;
  state.tickRunning = true;

  try {
    const risk = await riskService.getConfig();
    if (!risk.simAutoSnapshotEnabled) return;

    const summaries = await archiveService.createAutoSnapshotIfDue({
      intervalSec: risk.simAutoSnapshotIntervalSeconds,
      minIntervalSec: MIN_AUTO_SNAPSHOT_INTERVAL_SECONDS,
    });
    if (summaries.length > 0) {
      emitSimulationSnapshotCreated();
      recordSnapshotCreated('auto', 'sim');
      recordSnapshotCount(await archiveService.countSnapshots(), 'sim');
      for (const summary of summaries) {
        log.info(
          { snapshotId: summary.id, intervalSec: risk.simAutoSnapshotIntervalSeconds },
          'automatic simulation snapshot created',
        );
      }
    }

    // Prune old snapshots if retention policy is configured
    if (risk.simSnapshotMaxCount != null || risk.simSnapshotRetentionDays != null) {
      const pruned = await archiveService.pruneSnapshots({
        maxCount: risk.simSnapshotMaxCount,
        retentionDays: risk.simSnapshotRetentionDays,
      });
      if (pruned > 0) {
        log.info({ pruned }, 'old snapshots pruned by retention policy');
        recordSnapshotPurge(pruned, 'sim');
        recordSnapshotCount(await archiveService.countSnapshots(), 'sim');
      }
    }
  } catch (err) {
    log.warn({ err }, 'automatic simulation snapshot failed');
  } finally {
    state.tickRunning = false;
  }
}
