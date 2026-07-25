import type { DataSource } from 'typeorm';
import { SystemConfigService } from '../services/system-config.service.js';
import {
  OPEN_SNAPSHOT_DELAY_MS,
  CLOSE_SNAPSHOT_DELAY_MS,
  SURVEILLANCE_CLOSE_TTL_MS,
  REDEMPTION_WIN_THRESHOLD,
  REDEMPTION_LOSS_THRESHOLD,
} from './algo-surveillance.types.js';

// ── SystemConfig-aware resolvers (async, fallback to hardcoded defaults) ──

let _systemConfigService: SystemConfigService | null = null;

export function initSurveillanceConfigService(ds: DataSource): void {
  _systemConfigService = new SystemConfigService(ds);
}

async function resolveSurveillanceConfig(key: string, fallback: number): Promise<number> {
  if (!_systemConfigService) return fallback;
  return _systemConfigService.getNumber(key, fallback);
}

export async function resolveOpenSnapshotDelayMs(): Promise<number> {
  return resolveSurveillanceConfig('surveillance.open_snapshot_delay_ms', OPEN_SNAPSHOT_DELAY_MS);
}

export async function resolveCloseSnapshotDelayMs(): Promise<number> {
  return resolveSurveillanceConfig('surveillance.close_snapshot_delay_ms', CLOSE_SNAPSHOT_DELAY_MS);
}

export async function resolveSurveillanceCloseTtlMs(): Promise<number> {
  return resolveSurveillanceConfig('surveillance.close_ttl_ms', SURVEILLANCE_CLOSE_TTL_MS);
}

export async function resolveRedemptionWinThreshold(): Promise<number> {
  return resolveSurveillanceConfig('surveillance.redemption_win_threshold', REDEMPTION_WIN_THRESHOLD);
}

export async function resolveRedemptionLossThreshold(): Promise<number> {
  return resolveSurveillanceConfig('surveillance.redemption_loss_threshold', REDEMPTION_LOSS_THRESHOLD);
}
