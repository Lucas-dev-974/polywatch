import { describe, expect, it } from 'vitest';
import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves when the promise completes in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'timeout')).resolves.toBe(42);
  });

  it('rejects with the configured error code on timeout', async () => {
    await expect(
      withTimeout(new Promise<number>(() => {}), 20, 'clob_order_timeout'),
    ).rejects.toThrow('clob_order_timeout');
  });

  it('rejects when the abort signal fires before the promise settles', async () => {
    const controller = new AbortController();
    const pending = withTimeout(
      new Promise<number>(() => {}),
      5_000,
      'clob_order_timeout',
      controller.signal,
    );
    controller.abort(new Error('position_lock_timeout'));
    await expect(pending).rejects.toThrow('position_lock_timeout');
  });
});
