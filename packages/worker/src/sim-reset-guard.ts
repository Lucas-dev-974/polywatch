import { JobDiscardedError } from '@polywatch/core';
import type { TradingMode } from '@polywatch/core';

/** Monotonic counter bumped on each `simulation-reset` pub/sub message. */
export class SimResetGeneration {
  private generation = 0;

  bump(): number {
    this.generation += 1;
    return this.generation;
  }

  current(): number {
    return this.generation;
  }
}

/**
 * If a sim job fails after a simulation-reset arrived mid-flight, convert the
 * failure into {@link JobDiscardedError} so RedisQueue does not RPUSH it back
 * into a queue the backend just purged.
 */
export function wrapSimResetAwareHandler<T extends { mode: TradingMode }>(
  gen: SimResetGeneration,
  handle: (job: T) => Promise<void>,
): (job: T) => Promise<void> {
  return async (job: T) => {
    const genAtStart = gen.current();
    try {
      await handle(job);
    } catch (err) {
      if (job.mode === 'sim' && gen.current() !== genAtStart) {
        throw new JobDiscardedError(
          'simulation-reset during in-flight sim job — discard without requeue',
        );
      }
      throw err;
    }
  };
}
