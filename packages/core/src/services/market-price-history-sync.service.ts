import type { DataSource } from 'typeorm';
import { MarketPriceHistorySync } from '../entities/MarketPriceHistorySync.js';

export class MarketPriceHistorySyncService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(MarketPriceHistorySync);
  }

  async findByConditionAndAsset(
    conditionId: string,
    assetId: string,
  ): Promise<MarketPriceHistorySync | null> {
    return this.repo().findOne({
      where: { conditionId, assetId },
    });
  }

  async upsert(
    conditionId: string,
    assetId: string,
    endDate: Date | null,
  ): Promise<MarketPriceHistorySync> {
    const existing = await this.findByConditionAndAsset(conditionId, assetId);
    if (existing) {
      if (endDate && (!existing.endDate || endDate > existing.endDate)) {
        existing.endDate = endDate;
        await this.repo().save(existing);
      }
      return existing;
    }
    const row = this.repo().create({
      conditionId,
      assetId,
      endDate,
      syncStatus: 'idle',
    });
    return this.repo().save(row);
  }

  /**
   * Mark all sync entries for a given conditionId as terminal.
   * Called when a market is detected as resolved/redeemed so the
   * price-history syncer stops polling it.
   */
  async markTerminalForCondition(conditionId: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update()
      .set({ syncStatus: 'terminal', nextSyncAt: null })
      .where('condition_id = :conditionId', { conditionId })
      .andWhere("sync_status != 'terminal'")
      .execute();
  }

  async findPending(limit = 10): Promise<MarketPriceHistorySync[]> {
    return this.repo()
      .createQueryBuilder('s')
      .where("s.sync_status IN ('idle','error')")
      .andWhere('(s.next_sync_at IS NULL OR s.next_sync_at <= NOW())')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM markets m
          WHERE m.condition_id = s.condition_id
            AND (m.resolved = true OR m.winning_token_id IS NOT NULL)
        )`,
      )
      .orderBy('s.next_sync_at', 'ASC')
      .take(limit)
      .getMany();
  }

  async findExpiring(): Promise<MarketPriceHistorySync[]> {
    return this.repo()
      .createQueryBuilder('s')
      .where("s.sync_status != 'terminal'")
      .andWhere('s.end_date IS NOT NULL')
      .andWhere('s.end_date <= NOW()')
      .andWhere(
        '(s.last_synced_at IS NULL OR s.last_synced_at < s.end_date)',
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM markets m
          WHERE m.condition_id = s.condition_id
            AND (m.resolved = true OR m.winning_token_id IS NOT NULL)
        )`,
      )
      .getMany();
  }

  async updateStatus(
    id: number,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.repo().update(id, {
      syncStatus: status,
      errorMessage: errorMessage ?? null,
    });
  }

  async markTerminal(id: number): Promise<void> {
    await this.repo().update(id, {
      syncStatus: 'terminal',
      nextSyncAt: null,
    });
  }

  async updateSyncProgress(
    id: number,
    lastPointTs: number,
    nextSyncAt: Date,
  ): Promise<void> {
    await this.repo().update(id, {
      lastPointTs,
      lastSyncedAt: new Date(),
      nextSyncAt,
      syncStatus: 'idle',
      errorMessage: null,
    });
  }
}
