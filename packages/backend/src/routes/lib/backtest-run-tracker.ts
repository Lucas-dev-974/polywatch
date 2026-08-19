const BACKTEST_TIMEOUT_MS = Number(process.env.BACKTEST_TIMEOUT_MS ?? 30 * 60 * 1000);

interface RunTracker {
  cancelled: boolean;
  timedOut: boolean;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * In-process backtest job registry. A single run per domain can be active at
 * a time (singleton lock enforced by BacktestRunService.hasActiveRun).
 */
export class BacktestRunTracker {
  private readonly activeRuns = new Map<number, RunTracker>();

  /** Register a run and arm its timeout. */
  track(runId: number): void {
    const tracker: RunTracker = { cancelled: false, timedOut: false };
    tracker.timeoutId = setTimeout(() => {
      tracker.timedOut = true;
    }, BACKTEST_TIMEOUT_MS);
    this.activeRuns.set(runId, tracker);
  }

  /** Release a run (clear timeout + remove from registry). */
  release(runId: number): void {
    const tracker = this.activeRuns.get(runId);
    if (tracker?.timeoutId) clearTimeout(tracker.timeoutId);
    this.activeRuns.delete(runId);
  }

  /** Request cooperative cancellation of a run. */
  cancel(runId: number): void {
    const tracker = this.activeRuns.get(runId);
    if (tracker) tracker.cancelled = true;
  }

  /** Abort reason for a run, or null when it should keep running. */
  getAbortReason(runId: number): 'cancelled' | 'timeout' | null {
    const tracker = this.activeRuns.get(runId);
    if (!tracker) return null;
    if (tracker.timedOut) return 'timeout';
    if (tracker.cancelled) return 'cancelled';
    return null;
  }

  /** Best-effort cancel of all in-flight runs (graceful shutdown). */
  cancelAll(): void {
    for (const tracker of this.activeRuns.values()) {
      tracker.cancelled = true;
      if (tracker.timeoutId) clearTimeout(tracker.timeoutId);
    }
  }
}

/**
 * Module-scoped singleton shared by the router and the graceful-shutdown hook.
 * Mirrors the original module-scoped `activeRuns` map behaviour.
 */
export const backtestRunTracker = new BacktestRunTracker();
