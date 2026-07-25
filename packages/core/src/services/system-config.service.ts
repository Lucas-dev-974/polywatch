import type { DataSource, Repository } from 'typeorm';
import { SystemConfig } from '../entities/SystemConfig.js';

const CACHE_TTL_MS = 10_000;

type CacheEntry = {
  value: string;
  expiresAt: number;
};

export class SystemConfigService {
  private static cache: Map<string, CacheEntry> = new Map();
  private repo: Repository<SystemConfig>;

  constructor(private readonly ds: DataSource) {
    this.repo = ds.getRepository(SystemConfig);
  }

  static invalidateCache(): void {
    SystemConfigService.cache.clear();
  }

  private getCached(key: string): string | null {
    const entry = SystemConfigService.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.value;
    }
    if (entry) SystemConfigService.cache.delete(key);
    return null;
  }

  private setCached(key: string, value: string): void {
    SystemConfigService.cache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  async get(key: string): Promise<string | null> {
    const cached = this.getCached(key);
    if (cached !== null) return cached;

    const row = await this.repo.findOne({ where: { key } });
    if (!row) return null;

    this.setCached(key, row.value);
    return row.value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const val = await this.get(key);
    if (val === null) return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const val = await this.get(key);
    if (val === null) return fallback;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return fallback;
  }

  async set(key: string, value: string): Promise<void> {
    await this.repo.upsert(
      { key, value, updatedAt: new Date() },
      { conflictPaths: ['key'] },
    );
    this.setCached(key, value);
  }

  async getByCategory(category: string): Promise<SystemConfig[]> {
    return this.repo.find({ where: { category } });
  }

  async getAll(): Promise<SystemConfig[]> {
    return this.repo.find();
  }

  async seedDefaults(
    defaults: { key: string; value: string; category?: string; description?: string }[],
  ): Promise<void> {
    for (const entry of defaults) {
      const existing = await this.repo.findOne({ where: { key: entry.key } });
      if (!existing) {
        await this.repo.save(
          this.repo.create({
            key: entry.key,
            value: entry.value,
            category: entry.category ?? null,
            description: entry.description ?? null,
          }),
        );
      }
    }
    SystemConfigService.cache.clear();
  }
}
