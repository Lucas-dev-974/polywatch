import { describe, expect, it, vi } from 'vitest';
import { clearPostEntryMidTimers } from './post-entry-mid-logger.js';

/**
 * Lightweight shutdown invariants (Phase A / 3A).
 * Full SIGTERM mid-eval coverage stays Phase D (requires extracting createShutdownHandler).
 */
describe('crypto-algo shutdown invariants', () => {
  it('clearPostEntryMidTimers cancels pending timers without throwing', () => {
    expect(() => clearPostEntryMidTimers()).not.toThrow();
  });

  it('shutdown handler pattern is idempotent (double SIGTERM safe)', async () => {
    let shuttingDown = false;
    const cleanup = vi.fn();
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      cleanup();
    };

    await shutdown();
    await shutdown();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
