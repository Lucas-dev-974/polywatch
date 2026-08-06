import type { DataSource } from 'typeorm';
import { CopyConfig } from '../entities/CopyConfig.js';
import { BaseConfigService } from './base-config.service.js';

type ConfigCache = { config: CopyConfig; expiresAt: number };

export class CopyConfigService extends BaseConfigService<CopyConfig> {
  private static configCache: ConfigCache | null = null;

  protected readonly entity = CopyConfig;
  protected readonly notFoundMessage = 'Copy config not found';

  constructor(ds: DataSource) {
    super(ds);
  }

  protected getCache(): ConfigCache | null {
    return CopyConfigService.configCache;
  }

  protected setCache(cache: ConfigCache | null): void {
    CopyConfigService.configCache = cache;
  }

  static invalidateConfigCache(): void {
    CopyConfigService.configCache = null;
  }

  override invalidateConfigCache(): void {
    CopyConfigService.invalidateConfigCache();
  }
}
