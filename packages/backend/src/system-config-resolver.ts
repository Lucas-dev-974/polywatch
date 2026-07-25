import type { DataSource } from 'typeorm';
import { SystemConfigService } from '@polywatch/core/services/system-config.service';

let _systemConfigService: SystemConfigService | null = null;

export function initBackendConfigService(ds: DataSource): void {
  _systemConfigService = new SystemConfigService(ds);
}

export async function resolveBackendConfig(key: string, fallback: number): Promise<number> {
  if (!_systemConfigService) return fallback;
  return _systemConfigService.getNumber(key, fallback);
}
