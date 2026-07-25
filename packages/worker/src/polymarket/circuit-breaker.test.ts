import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import { RateLimitExceededError } from './rate-limited-fetch.js';

describe('CircuitBreaker', () => {
  it('does not count retryable 429 as a failure', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      cooldownMs: 30_000,
    });

    const rateLimitErr = new RateLimitExceededError(429);

    await expect(breaker.call(async () => { throw rateLimitErr; })).rejects.toThrow(
      RateLimitExceededError,
    );
    await expect(breaker.call(async () => { throw rateLimitErr; })).rejects.toThrow(
      RateLimitExceededError,
    );

    expect(breaker.getFailureCount()).toBe(0);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('opens after consecutive non-429 failures', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      cooldownMs: 30_000,
    });

    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow('fail');

    expect(breaker.getState()).toBe('OPEN');
  });
});

describe('rateLimitedFetch', () => {
  it('retries on 429 with backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ status: 429, headers: new Headers() } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true } as Response);

    const { rateLimitedFetch } = await import('./rate-limited-fetch.js');
    const { dataApiGeneralBucket } = await import('./token-bucket.js');

    const promise = rateLimitedFetch('https://example.com', dataApiGeneralBucket);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
