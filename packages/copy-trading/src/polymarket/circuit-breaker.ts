/**
 * Simple circuit breaker for external API calls.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  name: string;
  onStateChange?: (state: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions & {
    failureThreshold: number;
    cooldownMs: number;
  };

  constructor(options: Partial<CircuitBreakerOptions> & { name: string }) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      cooldownMs: options.cooldownMs ?? 30_000,
      name: options.name,
      onStateChange: options.onStateChange,
    };
  }

  private setState(next: CircuitState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onStateChange?.(next);
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.options.cooldownMs) {
        throw new CircuitBreakerOpenError(
          this.options.name,
          this.failureCount,
          this.options.cooldownMs - elapsed,
        );
      }
      this.setState('HALF_OPEN');
    }

    try {
      const result = await fn();
      this.setState('CLOSED');
      this.failureCount = 0;
      return result;
    } catch (err) {
      const retryable429 =
        (err as { retryable?: boolean }).retryable === true ||
        (err as { name?: string }).name === 'RateLimitExceededError';

      if (!retryable429) {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.options.failureThreshold) {
          this.setState('OPEN');
        } else if (this.state === 'HALF_OPEN') {
          this.setState('OPEN');
        }
      }

      throw err;
    }
  }

  reset(): void {
    this.setState('CLOSED');
    this.failureCount = 0;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    name: string,
    failureCount: number,
    remainingCooldownMs: number,
  ) {
    super(
      `Circuit breaker "${name}" is OPEN ` +
        `(${failureCount} failures, ${remainingCooldownMs}ms cooldown remaining)`,
    );
    this.name = 'CircuitBreakerOpenError';
  }
}
