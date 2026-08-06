import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import type { Logger } from 'pino';

export type CryptoAlgoShutdownDeps = {
  log: Pick<Logger, 'info' | 'warn'>;
  clearProcessTimers: () => void;
  strategyRunner: {
    stopAndDrain: (timeoutMs?: number) => Promise<void>;
  };
  selectionLoader: {
    stop: () => Promise<void>;
  };
  redisClients: Redis[];
  dataSource: Pick<DataSource, 'destroy'>;
  /** Override for tests (default process.exit). */
  exit?: (code: number) => void;
  drainTimeoutMs?: number;
};

/**
 * Build an idempotent SIGTERM/SIGINT handler.
 * Order: timers → stop+drain evals (includes WS disconnect via price feed) →
 * selection loader → Redis quit → DS destroy → exit.
 * Per-step errors are isolated so later cleanup still runs.
 */
export function createShutdownHandler(
  deps: CryptoAlgoShutdownDeps,
): () => Promise<void> {
  let shuttingDown = false;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const drainTimeoutMs = deps.drainTimeoutMs ?? 5_000;

  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.log.info('shutting down...');

    try {
      deps.clearProcessTimers();
    } catch (err) {
      deps.log.warn({ err }, 'failed to clear process timers');
    }

    try {
      await deps.strategyRunner.stopAndDrain(drainTimeoutMs);
    } catch (err) {
      deps.log.warn({ err }, 'failed to stop strategy runner');
    }

    try {
      await deps.selectionLoader.stop();
    } catch (err) {
      deps.log.warn({ err }, 'failed to stop selection loader');
    }

    const safeQuit = (r: Redis) => r.quit().catch(() => {});
    await Promise.all(deps.redisClients.map(safeQuit));
    await deps.dataSource.destroy().catch(() => {});
    exit(0);
  };
}
