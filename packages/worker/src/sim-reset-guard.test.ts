import { describe, expect, it } from 'vitest';
import { JobDiscardedError } from '@polywatch/core';
import { SimResetGeneration, wrapSimResetAwareHandler } from './sim-reset-guard.js';

describe('wrapSimResetAwareHandler', () => {
  it('rethrows original errors when no reset occurred', async () => {
    const gen = new SimResetGeneration();
    const wrapped = wrapSimResetAwareHandler(gen, async () => {
      throw new Error('boom');
    });
    await expect(wrapped({ mode: 'sim' })).rejects.toThrow('boom');
  });

  it('converts sim failures after reset into JobDiscardedError', async () => {
    const gen = new SimResetGeneration();
    const wrapped = wrapSimResetAwareHandler(gen, async () => {
      gen.bump();
      throw new Error('mid-flight fail');
    });
    await expect(wrapped({ mode: 'sim' })).rejects.toBeInstanceOf(JobDiscardedError);
  });

  it('does not discard real-mode failures after reset', async () => {
    const gen = new SimResetGeneration();
    const wrapped = wrapSimResetAwareHandler(gen, async () => {
      gen.bump();
      throw new Error('real fail');
    });
    await expect(wrapped({ mode: 'real' })).rejects.toThrow('real fail');
  });

  it('passes through successful sim jobs even if reset bumped mid-flight', async () => {
    const gen = new SimResetGeneration();
    let ran = false;
    const wrapped = wrapSimResetAwareHandler(gen, async () => {
      gen.bump();
      ran = true;
    });
    await wrapped({ mode: 'sim' });
    expect(ran).toBe(true);
  });
});
