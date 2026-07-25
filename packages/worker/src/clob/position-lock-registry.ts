/**
 * Shared position-level mutex across executor instances.
 *
 * Chains promises by `copiedPositionId` so that two signals for the same
 * position execute sequentially, while signals for different positions run
 * concurrently. Cleans up each entry after the chain resolves to avoid
 * unbounded memory growth.
 *
 * Each `fn` is wrapped with a timeout (default 60s). If the timeout fires,
 * the AbortSignal is aborted so cancellable downstream calls (fetch, TypeORM
 * queries) are released, and the chain is unblocked even if `fn` ignores the
 * signal.
 */
export const POSITION_LOCK_TIMEOUT_MS = 60_000;

export class PositionLockRegistry {
  private locks = new Map<number, Promise<void>>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = POSITION_LOCK_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /** Enqueue `fn` behind any pending work for `positionId`. */
  async runSequentially(
    positionId: number,
    fn: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const prev = this.locks.get(positionId) ?? Promise.resolve();
    // A rejection from the previous task must not propagate into (or skip)
    // the next task in the chain — each caller only sees its own error.
    const next = prev.catch(() => {}).then(() => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          const reason = new DOMException(
            'Position lock timeout',
            'TimeoutError',
          );
          controller.abort(reason);
          reject(reason);
        }, this.timeoutMs);
      });

      return Promise.race([
        fn(controller.signal),
        timeoutPromise,
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    });
    // Only the tail of the chain may clean up the entry: an inner task
    // completing must not delete a lock that later tasks already extended,
    // otherwise a concurrent signal would start a parallel chain.
    const tracked = next.catch(() => {}).then(() => {
      if (this.locks.get(positionId) === tracked) {
        this.locks.delete(positionId);
      }
    });
    this.locks.set(positionId, tracked);
    await next;
  }

  /** For testing — current number of tracked positions. */
  get size(): number {
    return this.locks.size;
  }
}
