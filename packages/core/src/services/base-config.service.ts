import type { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache<T> = {
  config: T;
  expiresAt: number;
};

/**
 * Shared singleton-config cache + get/update for the Global/Copy/Crypto/Weather
 * quartet (C2). Each subclass keeps its own static cache slot.
 */
export abstract class BaseConfigService<T extends ObjectLiteral> {
  protected abstract readonly entity: EntityTarget<T>;
  protected abstract readonly notFoundMessage: string;
  /** Per-subclass cache holder — set once on the concrete class. */
  protected abstract getCache(): ConfigCache<T> | null;
  protected abstract setCache(cache: ConfigCache<T> | null): void;

  constructor(protected readonly ds: DataSource) {}

  invalidateConfigCache(): void {
    this.setCache(null);
  }

  async getConfig(options?: {
    manager?: EntityManager;
    bypassCache?: boolean;
  }): Promise<T> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = this.getCache();
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(this.entity);
    const config = await repo.findOne({ where: {} as never });
    if (!config) throw new Error(this.notFoundMessage);
    if (!bypassCache) {
      this.setCache({
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      });
    }
    return config;
  }

  async updateConfig(partial: Partial<T>): Promise<T> {
    const repo = this.ds.getRepository(this.entity);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    this.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<T> {
    const config = await this.ds.getRepository(this.entity).findOne({
      where: {} as never,
    });
    if (!config) throw new Error(this.notFoundMessage);
    return config;
  }
}
