import type { DataSource } from 'typeorm';
import pino, { type Logger } from 'pino';
import { GlobalConfig } from '../entities/GlobalConfig.js';
import { createBackendClient, BACKEND_HTTP_TIMEOUT_MS } from '../worker-shared/backend-client.js';

// One pino instance per namespace, cached for the lifetime of the module so
// we don't reallocate a logger on every call (preserves the original top-level
// pattern while still allowing per-caller namespaces).
const loggerCache = new Map<string, Logger>();
function getLogger(name: string): Logger {
  let log = loggerCache.get(name);
  if (!log) {
    log = pino({ name });
    loggerCache.set(name, log);
  }
  return log;
}

/**
 * Fetch available real cash for an algo's real-mode sizing.
 *
 * 1. Checks for `realCashOverride` in GlobalConfig — if set, returns that value directly.
 * 2. Otherwise, calls the backend's /api/internal/balances endpoint to get the on-chain balance.
 *
 * Returns undefined when real cash cannot be determined (backend unavailable, no credentials, etc.).
 *
 * @param logName Optional pino logger name; defaults to `'algo:real-cash'`. Callers should
 *   pass their own namespace (e.g. `'weather-algo:real-cash'`) to preserve observability.
 */
export async function fetchAvailableRealCash(
  ds: DataSource,
  backendUrl: string,
  serviceToken: string,
  logName = 'algo:real-cash',
): Promise<number | undefined> {
  const log = getLogger(logName);

  // Step 1: Check for override in GlobalConfig
  try {
    const globalConfig = await ds.getRepository(GlobalConfig).findOne({ where: {} });
    if (globalConfig?.realCashOverride != null) {
      log.info(
        { realCashOverride: globalConfig.realCashOverride },
        'using realCashOverride from GlobalConfig',
      );
      return globalConfig.realCashOverride;
    }
  } catch (err) {
    log.warn({ err }, 'failed to read GlobalConfig.realCashOverride — falling back to backend');
  }

  // Step 2: Call backend for on-chain balance
  const { getBackendJson } = createBackendClient({ backendUrl, serviceToken });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_HTTP_TIMEOUT_MS);

  try {
    const res = await getBackendJson('/api/internal/balances?mode=real', controller.signal);

    if (!res.ok) {
      log.warn(
        { status: res.status },
        'backend /api/internal/balances returned non-OK — real cash unavailable',
      );
      return undefined;
    }

    const data = (await res.json()) as { amount?: number; error?: string };
    if (typeof data.amount === 'number') {
      log.debug({ amount: data.amount }, 'fetched real available cash from backend');
      return data.amount;
    }

    log.warn(
      { response: data },
      'backend /api/internal/balances returned unexpected shape — real cash unavailable',
    );
    return undefined;
  } catch (err) {
    log.warn({ err }, 'failed to fetch real cash from backend');
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}