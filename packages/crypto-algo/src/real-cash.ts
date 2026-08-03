import type { DataSource } from 'typeorm';
import { fetchAvailableRealCash as fetchAvailableRealCashCore } from '@polywatch/core';

/**
 * Fetch available real cash for crypto-algo real-mode sizing.
 * Thin wrapper around the shared `@polywatch/core` helper that preserves the
 * `crypto-algo:real-cash` log namespace for observability.
 */
export async function fetchAvailableRealCash(
  ds: DataSource,
  backendUrl: string,
  serviceToken: string,
): Promise<number | undefined> {
  return fetchAvailableRealCashCore(ds, backendUrl, serviceToken, 'crypto-algo:real-cash');
}