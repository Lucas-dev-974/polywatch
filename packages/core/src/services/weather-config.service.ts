import type { DataSource, EntityManager } from 'typeorm';
import { WeatherConfig } from '../entities/WeatherConfig.js';

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache = {
  config: WeatherConfig;
  expiresAt: number;
};

export class WeatherConfigService {
  private static configCache: ConfigCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    WeatherConfigService.configCache = null;
  }

  async getConfig(options?: {
    manager?: EntityManager;
    bypassCache?: boolean;
  }): Promise<WeatherConfig> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = WeatherConfigService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(WeatherConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Weather config not found');
    if (!bypassCache) {
      WeatherConfigService.configCache = {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return config;
  }

  async updateConfig(partial: Partial<WeatherConfig>): Promise<WeatherConfig> {
    const repo = this.ds.getRepository(WeatherConfig);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    WeatherConfigService.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<WeatherConfig> {
    const config = await this.ds.getRepository(WeatherConfig).findOne({
      where: {},
    });
    if (!config) throw new Error('Weather config not found');
    return config;
  }
}
