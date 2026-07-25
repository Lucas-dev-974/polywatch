import type { DataSource } from 'typeorm';
import pino from 'pino';
import { AlgoSurveillanceService, SURVEILLANCE_CLOSE_TTL_MS, safeInterval } from '@polywatch/core';

const log = pino({ name: 'crypto-algo:surveillance-janitor' });

/** Interval between janitor sweeps. */
export const SURVEILLANCE_JANITOR_INTERVAL_MS = 60_000;

/**
 * Periodically scans `algo_surveillance_snapshots` for windows whose close
 * never arrived. First tries to resolve each snapshot from the local `markets`
 * table; if that fails, marks it as `unresolved` so the UI stops showing
 * "Résolution…" forever.
 */
export function startSurveillanceJanitor(
  ds: DataSource,
  intervalMs = SURVEILLANCE_JANITOR_INTERVAL_MS,
  ttlMs = SURVEILLANCE_CLOSE_TTL_MS,
): () => void {
  const service = new AlgoSurveillanceService(ds);

  const tick = async (): Promise<void> => {
    try {
      const marked = await service.markUnresolvedIfDeadlinePassed(ttlMs);
      if (marked > 0) {
        log.info({ marked }, 'surveillance snapshots marked as unresolved');
      }
    } catch (err) {
      log.warn({ err }, 'surveillance janitor tick failed');
    }
  };

  void tick();
  const timer = safeInterval(
    () => tick(),
    intervalMs,
    'crypto-algo:surveillance-janitor',
  );

  return () => clearInterval(timer);
}
