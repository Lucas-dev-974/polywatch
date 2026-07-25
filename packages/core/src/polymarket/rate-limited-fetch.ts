import { sleep } from '@polywatch/core';
import type { TokenBucket } from './token-bucket.js';

const MAX_429_RETRIES = 3;

/** Thrown for 429 responses — not counted as circuit-breaker failures. */
export class RateLimitExceededError extends Error {
  readonly retryable = true;

  constructor(public readonly status: number) {
    super(`Rate limited: HTTP ${status}`);
    this.name = 'RateLimitExceededError';
  }
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 30_000);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - Date.now()), 30_000);
  }
  return null;
}

export async function rateLimitedFetch(
  url: string,
  bucket: TokenBucket,
  retry429Count = 0,
): Promise<Response> {
  await bucket.acquire();
  const res = await fetch(url);

  if (res.status === 429) {
    if (retry429Count < MAX_429_RETRIES) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After'));
      const backoff = retryAfterMs ?? Math.min(1_000 * 2 ** retry429Count, 8_000);
      const jitter = Math.random() * 500;
      await sleep(backoff + jitter);
      return rateLimitedFetch(url, bucket, retry429Count + 1);
    }
    throw new RateLimitExceededError(429);
  }

  return res;
}