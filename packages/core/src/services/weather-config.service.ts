import type { DataSource } from 'typeorm';
import { WeatherConfig } from '../entities/WeatherConfig.js';
import { BaseConfigService } from './base-config.service.js';

type ConfigCache = { config: WeatherConfig; expiresAt: number };

export class WeatherConfigService extends BaseConfigService<WeatherConfig> {
  private static configCache: ConfigCache | null = null;

  protected readonly entity = WeatherConfig;
  protected readonly notFoundMessage = 'Weather config not found';

  constructor(ds: DataSource) {
    super(ds);
  }

  protected getCache(): ConfigCache | null {
    return WeatherConfigService.configCache;
  }

  protected setCache(cache: ConfigCache | null): void {
    WeatherConfigService.configCache = cache;
  }

  static invalidateConfigCache(): void {
    WeatherConfigService.configCache = null;
  }

  override invalidateConfigCache(): void {
    WeatherConfigService.invalidateConfigCache();
  }
}
