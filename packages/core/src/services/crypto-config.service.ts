import type { DataSource, EntityManager } from 'typeorm';
import { CryptoConfig } from '../entities/CryptoConfig.js';

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache = {
  config: CryptoConfig;
  expiresAt: number;
};

export class CryptoConfigService {
  private static configCache: ConfigCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    CryptoConfigService.configCache = null;
  }

  async getConfig(options?: {
    manager?: EntityManager;
    bypassCache?: boolean;
  }): Promise<CryptoConfig> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = CryptoConfigService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(CryptoConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Crypto config not found');
    if (!bypassCache) {
      CryptoConfigService.configCache = {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return config;
  }

  async updateConfig(partial: Partial<CryptoConfig>): Promise<CryptoConfig> {
    const repo = this.ds.getRepository(CryptoConfig);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    CryptoConfigService.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<CryptoConfig> {
    const config = await this.ds.getRepository(CryptoConfig).findOne({
      where: {},
    });
    if (!config) throw new Error('Crypto config not found');
    return config;
  }
}
