import type { DataSource } from 'typeorm';
import { IntegrationSettings } from '@polywatch/core';
import { config } from '../config.js';
import { decrypt, encrypt } from '../crypto/encryption.js';

export type PolygonscanApiKeySource = 'env' | 'stored';

export interface PolygonscanSettingsStatus {
  configured: boolean;
  source: PolygonscanApiKeySource | null;
  hasStoredKey: boolean;
  envConfigured: boolean;
}

async function getOrCreateIntegrationSettings(
  ds: DataSource,
): Promise<IntegrationSettings> {
  const repo = ds.getRepository(IntegrationSettings);
  let settings = await repo.findOne({ where: {} });
  if (!settings) {
    settings = repo.create({});
    await repo.save(settings);
  }
  return settings;
}

export async function resolvePolygonscanApiKey(
  ds: DataSource,
): Promise<string | undefined> {
  const envKey = config.polygonscanApiKey;
  if (envKey) return envKey;

  const settings = await getOrCreateIntegrationSettings(ds);
  if (!settings.polygonscanApiKeyEnc) return undefined;
  return decrypt(settings.polygonscanApiKeyEnc);
}

export async function getPolygonscanSettingsStatus(
  ds: DataSource,
): Promise<PolygonscanSettingsStatus> {
  const envConfigured = !!config.polygonscanApiKey;
  if (envConfigured) {
    return {
      configured: true,
      source: 'env',
      hasStoredKey: false,
      envConfigured: true,
    };
  }

  const settings = await getOrCreateIntegrationSettings(ds);
  const hasStoredKey = !!settings.polygonscanApiKeyEnc;
  return {
    configured: hasStoredKey,
    source: hasStoredKey ? 'stored' : null,
    hasStoredKey,
    envConfigured: false,
  };
}

export async function savePolygonscanApiKey(
  ds: DataSource,
  apiKey: string,
): Promise<void> {
  if (config.polygonscanApiKey) {
    throw new Error('polygonscan_api_key_env_locked');
  }

  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('polygonscan_api_key_required');
  }

  const repo = ds.getRepository(IntegrationSettings);
  const settings = await getOrCreateIntegrationSettings(ds);
  settings.polygonscanApiKeyEnc = encrypt(trimmed);
  await repo.save(settings);
}

export async function clearStoredPolygonscanApiKey(ds: DataSource): Promise<void> {
  if (config.polygonscanApiKey) {
    throw new Error('polygonscan_api_key_env_locked');
  }

  const repo = ds.getRepository(IntegrationSettings);
  const settings = await getOrCreateIntegrationSettings(ds);
  settings.polygonscanApiKeyEnc = null;
  await repo.save(settings);
}
