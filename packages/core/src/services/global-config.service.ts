import type { DataSource, EntityManager } from 'typeorm';
import { GlobalConfig } from '../entities/GlobalConfig.js';

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache = {
  config: GlobalConfig;
  expiresAt: number;
};

export class GlobalConfigService {
  private static configCache: ConfigCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    GlobalConfigService.configCache = null;
  }

  async getConfig(options?: {
    manager?: EntityManager;
    bypassCache?: boolean;
  }): Promise<GlobalConfig> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = GlobalConfigService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(GlobalConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Global config not found');
    if (!bypassCache) {
      GlobalConfigService.configCache = {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return config;
  }

  async updateConfig(partial: Partial<GlobalConfig>): Promise<GlobalConfig> {
    const repo = this.ds.getRepository(GlobalConfig);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    GlobalConfigService.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<GlobalConfig> {
    const config = await this.ds.getRepository(GlobalConfig).findOne({
      where: {},
    });
    if (!config) throw new Error('Global config not found');
    return config;
  }
}
