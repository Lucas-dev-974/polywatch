import { describe, expect, it } from 'vitest';
import { sleepUnlessAborted } from '../helpers/sleep-unless-aborted.js';

describe('sleepUnlessAborted', () => {
  it('resolves true immediately when ms <= 0', async () => {
    const ac = new AbortController();
    await expect(sleepUnlessAborted(0, ac.signal)).resolves.toBe(true);
  });

  it('resolves false when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleepUnlessAborted(50, ac.signal)).resolves.toBe(false);
  });

  it('resolves false when aborted during sleep', async () => {
    const ac = new AbortController();
    const pending = sleepUnlessAborted(500, ac.signal);
    ac.abort();
    await expect(pending).resolves.toBe(false);
  });
});
