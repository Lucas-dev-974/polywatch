import type { DataSource } from 'typeorm';
import { GlobalConfig } from '../entities/GlobalConfig.js';
import { BaseConfigService } from './base-config.service.js';

type ConfigCache = { config: GlobalConfig; expiresAt: number };

export class GlobalConfigService extends BaseConfigService<GlobalConfig> {
  private static configCache: ConfigCache | null = null;

  protected readonly entity = GlobalConfig;
  protected readonly notFoundMessage = 'Global config not found';

  constructor(ds: DataSource) {
    super(ds);
  }

  protected getCache(): ConfigCache | null {
    return GlobalConfigService.configCache;
  }

  protected setCache(cache: ConfigCache | null): void {
    GlobalConfigService.configCache = cache;
  }

  static invalidateConfigCache(): void {
    GlobalConfigService.configCache = null;
  }

  override invalidateConfigCache(): void {
    GlobalConfigService.invalidateConfigCache();
  }
}
