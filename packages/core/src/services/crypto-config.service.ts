import type { DataSource } from 'typeorm';
import { CryptoConfig } from '../entities/CryptoConfig.js';
import { BaseConfigService } from './base-config.service.js';

type ConfigCache = { config: CryptoConfig; expiresAt: number };

export class CryptoConfigService extends BaseConfigService<CryptoConfig> {
  private static configCache: ConfigCache | null = null;

  protected readonly entity = CryptoConfig;
  protected readonly notFoundMessage = 'Crypto config not found';

  constructor(ds: DataSource) {
    super(ds);
  }

  protected getCache(): ConfigCache | null {
    return CryptoConfigService.configCache;
  }

  protected setCache(cache: ConfigCache | null): void {
    CryptoConfigService.configCache = cache;
  }

  static invalidateConfigCache(): void {
    CryptoConfigService.configCache = null;
  }

  override invalidateConfigCache(): void {
    CryptoConfigService.invalidateConfigCache();
  }
}
