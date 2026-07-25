/**
 * Simple circuit breaker for external API calls.
 *
 * States:
 *   CLOSED  — normal operation, calls pass through
 *   OPEN    — failure threshold reached, calls are rejected immediately
 *   HALF_OPEN — cooldown elapsed, one probe call is allowed
 *
 * When a probe succeeds the circuit resets to CLOSED.
 * When a probe fails the circuit re-opens and the cooldown restarts.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning to HALF_OPEN. */
  cooldownMs: number;
  /** Name for logging. */
  name: string;
  /** Called when the circuit state changes. */
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

  /**
   * Execute `fn` through the circuit breaker.
   * - If the circuit is OPEN and still in cooldown, throws CircuitBreakerOpenError.
   * - If the circuit is HALF_OPEN, allows one probe call.
   * - On success: resets failure count, closes circuit.
   * - On failure: increments count, opens circuit if threshold reached.
   */
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
      // Cooldown expired — transition to half-open
      this.setState('HALF_OPEN');
    }

    try {
      const result = await fn();
      // Success — reset circuit
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
          // Probe failed — back to OPEN
          this.setState('OPEN');
        }
      }

      throw err;
    }
  }

  /** Force-reset the circuit breaker to CLOSED. */
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

/**
 * Wraps an async function with a circuit breaker.
 * Returns a new function that goes through the breaker.
 */
export function withCircuitBreaker<T, A extends unknown[]>(
  fn: (...args: A) => Promise<T>,
  options: CircuitBreakerOptions,
): (...args: A) => Promise<T> {
  const breaker = new CircuitBreaker(options);
  return async (...args: A): Promise<T> => {
    return breaker.call(() => fn(...args));
  };
}