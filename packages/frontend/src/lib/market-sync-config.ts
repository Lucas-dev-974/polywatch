import { api } from '../api';

export interface MarketSyncConfig {
  id: number;
  maxMarketsPerCycle: number;
  defaultFidelityMinutes: number;
  expirationFidelityMinutes: number;
  hourlySyncIntervalMs: number;
  expirationIntervalMs: number;
  tickRetentionDays: number;
}

export function fetchMarketSyncConfig(): Promise<MarketSyncConfig> {
  return api<MarketSyncConfig>('/market-sync-config');
}

export function saveMarketSyncConfig(
  patch: Partial<MarketSyncConfig>,
): Promise<MarketSyncConfig> {
  return api<MarketSyncConfig>('/market-sync-config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}
