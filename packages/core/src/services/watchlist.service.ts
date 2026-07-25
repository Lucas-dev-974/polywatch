import type { DataSource } from 'typeorm';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { MAX_WATCHLIST_SIZE } from '../types/index.js';

const CACHE_TTL_MS = 5_000;

type ListCache = {
  entries: WatchlistEntry[];
  expiresAt: number;
};

export class WatchlistService {
  private static listCache: ListCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateCache(): void {
    WatchlistService.listCache = null;
  }

  async loadAll(): Promise<WatchlistEntry[]> {
    const cached = WatchlistService.listCache;
    if (cached && Date.now() < cached.expiresAt) {
      return cached.entries;
    }

    const entries = await this.ds.getRepository(WatchlistEntry).find({
      order: { createdAt: 'ASC' },
    });
    WatchlistService.listCache = {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return entries;
  }

  async findById(id: number): Promise<WatchlistEntry | null> {
    return this.ds.getRepository(WatchlistEntry).findOne({ where: { id } });
  }

  async findByTraderAddress(
    traderAddress: string,
  ): Promise<WatchlistEntry | null> {
    const normalized = traderAddress.toLowerCase();
    const entries = await this.loadAll();
    return entries.find((e) => e.traderAddress === normalized) ?? null;
  }

  async create(
    data: Partial<WatchlistEntry> & { traderAddress: string },
  ): Promise<WatchlistEntry> {
    const repo = this.ds.getRepository(WatchlistEntry);
    const count = await repo.count();
    if (count >= MAX_WATCHLIST_SIZE) {
      throw new Error('max_watchlist_size');
    }
    WatchlistService.invalidateCache();
    return repo.save(
      repo.create({
        ...data,
        traderAddress: data.traderAddress.toLowerCase(),
      }),
    );
  }

  async update(
    id: number,
    data: Partial<WatchlistEntry>,
  ): Promise<WatchlistEntry> {
    const repo = this.ds.getRepository(WatchlistEntry);
    const entry = await repo.findOne({ where: { id } });
    if (!entry) throw new Error('not_found');
    Object.assign(entry, data);
    WatchlistService.invalidateCache();
    return repo.save(entry);
  }

  async delete(id: number): Promise<void> {
    await this.ds.getRepository(WatchlistEntry).delete({ id });
    WatchlistService.invalidateCache();
  }
}
