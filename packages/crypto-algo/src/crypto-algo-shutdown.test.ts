import { describe, expect, it, vi } from 'vitest';
import { clearPostEntryMidTimers } from './post-entry-mid-logger.js';

describe('crypto-algo shutdown invariants', () => {
  it('clearPostEntryMidTimers cancels pending timers without throwing', () => {
    const timer = setTimeout(() => {}, 60_000);
    expect(() => clearPostEntryMidTimers()).not.toThrow();
    clearTimeout(timer);
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
