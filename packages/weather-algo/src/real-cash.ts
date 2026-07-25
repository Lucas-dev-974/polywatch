import type { DataSource } from 'typeorm';
import { RiskConfig, createBackendClient, BACKEND_HTTP_TIMEOUT_MS } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'weather-algo:real-cash' });

/**
 * Fetch available real cash for weather-algo real-mode sizing.
 * Mirrors the crypto-algo helper but logs under the weather-algo namespace.
 */
export async function fetchAvailableRealCash(
  ds: DataSource,
  backendUrl: string,
  serviceToken: string,
): Promise<number | undefined> {
  try {
    const riskConfig = await ds.getRepository(RiskConfig).findOne({ where: {} });
    if (riskConfig?.realCashOverride != null) {
      log.info(
        { realCashOverride: riskConfig.realCashOverride },
        'using realCashOverride from RiskConfig',
      );
      return riskConfig.realCashOverride;
    }
  } catch (err) {
    log.warn({ err }, 'failed to read RiskConfig.realCashOverride — falling back to backend');
  }

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