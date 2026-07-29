import type { DataSource, EntityManager } from 'typeorm';
import { CopyConfig } from '../entities/CopyConfig.js';

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache = {
  config: CopyConfig;
  expiresAt: number;
};

export class CopyConfigService {
  private static configCache: ConfigCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    CopyConfigService.configCache = null;
  }

  async getConfig(options?: {
    manager?: EntityManager;
    bypassCache?: boolean;
  }): Promise<CopyConfig> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = CopyConfigService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(CopyConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Copy config not found');
    if (!bypassCache) {
      CopyConfigService.configCache = {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return config;
  }

  async updateConfig(partial: Partial<CopyConfig>): Promise<CopyConfig> {
    const repo = this.ds.getRepository(CopyConfig);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    CopyConfigService.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<CopyConfig> {
    const config = await this.ds.getRepository(CopyConfig).findOne({
      where: {},
    });
    if (!config) throw new Error('Copy config not found');
    return config;
  }
}
