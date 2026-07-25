import { api } from '../api';

export type PolygonscanApiKeySource = 'env' | 'stored';

export interface PolygonscanSettingsStatus {
  configured: boolean;
  source: PolygonscanApiKeySource | null;
  hasStoredKey: boolean;
  envConfigured: boolean;
}

export function fetchPolygonscanSettingsStatus(): Promise<PolygonscanSettingsStatus> {
  return api<PolygonscanSettingsStatus>('/integration-settings/polygonscan/status');
}

export function savePolygonscanApiKey(apiKey: string): Promise<PolygonscanSettingsStatus> {
  return api<PolygonscanSettingsStatus>('/integration-settings/polygonscan', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
}

export function clearPolygonscanApiKey(): Promise<void> {
  return api<void>('/integration-settings/polygonscan', { method: 'DELETE' });
}
