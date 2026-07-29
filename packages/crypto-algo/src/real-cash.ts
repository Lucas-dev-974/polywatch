import type { DataSource } from 'typeorm';
import { GlobalConfig, createBackendClient, BACKEND_HTTP_TIMEOUT_MS } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'crypto-algo:real-cash' });

/**
 * Fetch available real cash for crypto-algo real-mode sizing.
 *
 * 1. Checks for `realCashOverride` in GlobalConfig — if set, returns that value directly.
 * 2. Otherwise, calls the backend's /api/internal/balances endpoint to get the on-chain balance.
 *
 * Returns undefined when real cash cannot be determined (backend unavailable, no credentials, etc.).
 */
export async function fetchAvailableRealCash(
  ds: DataSource,
  backendUrl: string,
  serviceToken: string,
): Promise<number | undefined> {
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