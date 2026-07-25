import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PositionLockRegistry } from './position-lock-registry.js';

const TEST_TIMEOUT_MS = 100;

describe('PositionLockRegistry', () => {
  let registry: PositionLockRegistry;

  beforeEach(() => {
    vi.useRealTimers();
    registry = new PositionLockRegistry(TEST_TIMEOUT_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes fn sequentially for the same position', async () => {
    const order: number[] = [];

    const p1 = registry.runSequentially(1, async (_signal) => {
      order.push(1);
    });
    const p2 = registry.runSequentially(1, async (_signal) => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('executes fns concurrently for different positions', async () => {
    const order: number[] = [];

    const p1 = registry.runSequentially(1, async (_signal) => {
      order.push(1);
    });
    const p2 = registry.runSequentially(2, async (_signal) => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it('cleans up map entry after fn completes', async () => {
    await registry.runSequentially(1, async (_signal) => {});
    expect(registry.size).toBe(0);
  });

  it('cleans up map entry after fn rejects', async () => {
    await expect(
      registry.runSequentially(1, async (_signal) => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(registry.size).toBe(0);
  });

  it('aborts the signal when fn times out', async () => {
    let aborted = false;

    const promise = registry.runSequentially(1, async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      }, { once: true });
      // Never resolve — hang until timeout
      await new Promise<void>(() => {});
    });

    await expect(promise).rejects.toThrow('Position lock timeout');
    expect(aborted).toBe(true);
  }, 5000);

  it('does not abort when fn completes before timeout', async () => {
    let aborted = false;

    await registry.runSequentially(1, async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      }, { once: true });
    });

    expect(aborted).toBe(false);
  });

  it('unblocks the chain after a timeout', async () => {
    let secondRan = false;

    // First call hangs and times out
    const p1 = registry.runSequentially(1, async (_signal) => {
      await new Promise<void>(() => {}); // hang
    });

    // Second call should run after the first times out
    const p2 = registry.runSequentially(1, async (_signal) => {
      secondRan = true;
    });

    await expect(p1).rejects.toThrow('Position lock timeout');
    await p2;

    expect(secondRan).toBe(true);
  }, 5000);
});
