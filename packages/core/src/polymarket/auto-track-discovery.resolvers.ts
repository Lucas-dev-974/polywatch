import type { DataSource } from 'typeorm';
import { SystemConfigService } from '../services/system-config.service.js';
import {
  AUTO_TRACK_FETCH_PAGE_SIZE,
  AUTO_TRACK_MAX_PAGES,
  AUTO_TRACK_SYNC_MIN_INTERVAL_MS,
  FUTURE_MARKETS_SYNC_MIN_INTERVAL_MS,
  SHORT_INTERVAL_JANITOR_MS,
  DEFAULT_JANITOR_MS,
} from './auto-track-discovery.js';

// ── SystemConfig-aware resolvers ──

let _autoTrackConfigService: SystemConfigService | null = null;

export function initAutoTrackConfigService(ds: DataSource): void {
  _autoTrackConfigService = new SystemConfigService(ds);
}

async function resolveAutoTrackConfig(key: string, fallback: number): Promise<number> {
  if (!_autoTrackConfigService) return fallback;
  return _autoTrackConfigService.getNumber(key, fallback);
}

export async function resolveAutoTrackFetchPageSize(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.fetch_page_size', AUTO_TRACK_FETCH_PAGE_SIZE);
}

export async function resolveAutoTrackMaxPages(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.max_pages', AUTO_TRACK_MAX_PAGES);
}

export async function resolveAutoTrackSyncMinIntervalMs(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.sync_min_interval_ms', AUTO_TRACK_SYNC_MIN_INTERVAL_MS);
}

export async function resolveFutureMarketsSyncMinIntervalMs(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.future_markets_sync_min_interval_ms', FUTURE_MARKETS_SYNC_MIN_INTERVAL_MS);
}

export async function resolveShortIntervalJanitorMs(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.janitor.short_interval_ms', SHORT_INTERVAL_JANITOR_MS);
}

export async function resolveDefaultJanitorMs(): Promise<number> {
  return resolveAutoTrackConfig('auto_track.janitor.default_interval_ms', DEFAULT_JANITOR_MS);
}
