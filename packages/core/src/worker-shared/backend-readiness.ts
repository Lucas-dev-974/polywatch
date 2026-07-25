import type { Redis } from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'backend-readiness' });

const CHANNEL = 'backend-ready';
const KEY = 'backend-ready';
const KEY_TTL_SECONDS = 60;

/**
 * Wait until the backend publishes a `backend-ready` event on Redis.
 * This avoids the worker hammering the internal HTTP API before the backend
 * has finished booting, which used to cause ECONNREFUSED errors.
 */
export async function waitForBackendReady(
  redisSub: Redis,
  timeoutMs = 60_000,
): Promise<void> {
  const redisCmd = redisSub.duplicate();

  try {
    // Fast path: a recent backend may have already published the signal.
    const cached = await redisCmd.get(KEY);
    if (cached) {
      try {
        const payload = JSON.parse(cached);
        if (payload?.ready) {
          log.info({ pid: payload.pid, at: payload.at }, 'backend ready (cached)');
          return;
        }
      } catch {
        // ignore malformed cached payload
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`backend-ready signal not received within ${timeoutMs}ms`),
        );
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        redisSub.off('message', onMessage);
      };

      const onMessage = (channel: string, message: string) => {
        if (channel !== CHANNEL) return;
        try {
          const payload = JSON.parse(message);
          if (payload?.ready) {
            log.info(
              { pid: payload.pid, at: payload.at },
              'backend ready signal received',
            );
            cleanup();
            resolve();
          }
        } catch {
          // ignore malformed message
        }
      };

      redisSub.on('message', onMessage);
      redisSub.subscribe(CHANNEL, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  } finally {
    void redisCmd.quit();
  }
}

/**
 * Parse a backend-ready payload from a Redis message or key value.
 */
export function parseBackendReadyPayload(raw: string): {
  ready: boolean;
  at?: number;
  pid?: number;
} | null {
  try {
    const payload = JSON.parse(raw);
    if (payload?.ready === true) {
      return {
        ready: true,
        at: typeof payload.at === 'number' ? payload.at : undefined,
        pid: typeof payload.pid === 'number' ? payload.pid : undefined,
      };
    }
  } catch {
    // ignore malformed payload
  }
  return null;
}