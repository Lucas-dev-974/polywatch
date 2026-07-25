import pino from 'pino';

const log = pino({ name: 'helpers' });

/**
 * Promise-based sleep for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a `setInterval`-like loop that catches and logs any rejection
 * from the async callback, preventing silent unhandled promise rejections.
 *
 * Returns a `NodeJS.Timeout` compatible with `clearInterval()`.
 */
export function safeInterval(
  fn: () => Promise<void>,
  intervalMs: number,
  label?: string,
): NodeJS.Timeout {
  return setInterval(() => {
    fn().catch((err) => {
      log.error({ err, label: label ?? 'safe-interval' }, 'unhandled rejection in interval loop');
    });
  }, intervalMs);
}