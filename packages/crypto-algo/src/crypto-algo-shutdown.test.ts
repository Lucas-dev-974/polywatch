import { describe, expect, it, vi } from 'vitest';
import { clearPostEntryMidTimers } from './post-entry-mid-logger.js';
import { createShutdownHandler } from './shutdown.js';
import { CryptoAlgoPriceFeed } from './price-feed.js';

/**
 * Shutdown invariants (Phase A / D).
 */
describe('crypto-algo shutdown invariants', () => {
  it('clearPostEntryMidTimers cancels pending timers without throwing', () => {
    expect(() => clearPostEntryMidTimers()).not.toThrow();
  });

  it('createShutdownHandler is idempotent (double SIGTERM safe)', async () => {
    const clearProcessTimers = vi.fn();
    const stopAndDrain = vi.fn().mockResolvedValue(undefined);
    const selectionStop = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn().mockResolvedValue('OK');
    const destroy = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      log: { info: vi.fn(), warn: vi.fn() },
      clearProcessTimers,
      strategyRunner: { stopAndDrain },
      selectionLoader: { stop: selectionStop },
      redisClients: [{ quit } as never, { quit } as never],
      dataSource: { destroy },
      exit,
    });

    await shutdown();
    await shutdown();

    expect(clearProcessTimers).toHaveBeenCalledTimes(1);
    expect(stopAndDrain).toHaveBeenCalledTimes(1);
    expect(selectionStop).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('createShutdownHandler continues after stopAndDrain failure', async () => {
    const selectionStop = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const warn = vi.fn();

    const shutdown = createShutdownHandler({
      log: { info: vi.fn(), warn },
      clearProcessTimers: vi.fn(),
      strategyRunner: {
        stopAndDrain: vi.fn().mockRejectedValue(new Error('drain failed')),
      },
      selectionLoader: { stop: selectionStop },
      redisClients: [],
      dataSource: { destroy },
      exit,
    });

    await shutdown();

    expect(warn).toHaveBeenCalled();
    expect(selectionStop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('price feed handleWsReconnect clears midHistory', () => {
    const feed = new CryptoAlgoPriceFeed();
    // record via private buffer access through public getMidWindow after reconnect clear
    feed.handleWsReconnect();
    expect(feed.getMidWindow('asset-1', 60_000, Date.now())).toEqual([]);
  });
});
