import type { DataSource } from 'typeorm';
import {
  ExecutionService,
  ReservationService,
  RiskConfig,
  createBackendClient,
  BACKEND_HTTP_TIMEOUT_MS,
} from '@polywatch/core';
import pino from 'pino';
import { config } from '../config.js';

const log = pino({ name: 'copy-trading:real-cash' });

/**
 * Available real cash for copy entry sizing.
 * Uses backend balance (or realCashOverride) minus active reservations and
 * in-flight BUY notional without a reservation row.
 */
export async function fetchAvailableRealCash(ds: DataSource): Promise<number | undefined> {
  let balance: number | undefined;

  try {
    const riskConfig = await ds.getRepository(RiskConfig).findOne({ where: {} });
    if (riskConfig?.realCashOverride != null) {
      balance = riskConfig.realCashOverride;
    }
  } catch (err) {
    log.warn({ err }, 'failed to read RiskConfig.realCashOverride — falling back to backend');
  }

  if (balance === undefined) {
    const { getBackendJson } = createBackendClient({
      backendUrl: config.backendUrl,
      serviceToken: config.serviceToken,
    });
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
      const data = (await res.json()) as { amount?: number };
      if (typeof data.amount !== 'number') {
        log.warn({ response: data }, 'backend balances returned unexpected shape');
        return undefined;
      }
      balance = data.amount;
    } catch (err) {
      log.warn({ err }, 'failed to fetch real cash from backend');
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  const reservationService = new ReservationService(ds);
  const executionService = new ExecutionService(ds);
  const [reserved, inFlight] = await Promise.all([
    reservationService.sumActiveReservedNotional('real'),
    executionService.sumInFlightBuyNotionalWithoutReservation('real'),
  ]);

  return Math.max(0, balance - reserved - inFlight);
}
