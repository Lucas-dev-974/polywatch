import { sleep } from '@polywatch/core';

/**
 * Token-bucket rate limiter for Polymarket API endpoints.
 * Refills linearly over a sliding window.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed / this.windowMs) * this.capacity,
    );
    this.lastRefillMs = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.capacity) * this.windowMs);
    await sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }
}

/** Shared buckets — limits per Polymarket sliding 10 s window. */
export const dataApiPositionsBucket = new TokenBucket(150, 10_000);
export const dataApiGeneralBucket = new TokenBucket(1_000, 10_000);
export const clobBookBucket = new TokenBucket(1_500, 10_000);