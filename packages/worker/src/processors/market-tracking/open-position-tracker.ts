import type { DataSource } from 'typeorm';
import { CopiedPosition } from '@polywatch/core';

export const TRACKED_POSITION_STATUSES = ['open', 'closing'] as const;

/**
 * In-memory view of the currently open/closing copied positions, indexed by assetId.
 *
 * The recorder checks this index on every book update to decide whether the asset
 * should be persisted to `market_position_ticks`, and to produce one tick row per
 * tracked position on that asset.
 */
export class OpenPositionTracker {
  private positionsByAsset = new Map<string, CopiedPosition[]>();

  constructor(private readonly ds: DataSource) {}

  async refresh(): Promise<void> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: TRACKED_POSITION_STATUSES.map((status) => ({ status })),
    });

    const next = new Map<string, CopiedPosition[]>();
    for (const pos of positions) {
      const list = next.get(pos.assetId) ?? [];
      list.push(pos);
      next.set(pos.assetId, list);
    }

    this.positionsByAsset = next;
  }

  hasPositions(assetId: string): boolean {
    const list = this.positionsByAsset.get(assetId);
    return list != null && list.length > 0;
  }

  getPositions(assetId: string): readonly CopiedPosition[] {
    return this.positionsByAsset.get(assetId) ?? [];
  }

  /** Optional incremental helper when a single position is known to transition. */
  addPosition(position: CopiedPosition): void {
    if (!TRACKED_POSITION_STATUSES.includes(position.status as (typeof TRACKED_POSITION_STATUSES)[number])) {
      return;
    }
    const list = this.positionsByAsset.get(position.assetId) ?? [];
    const idx = list.findIndex((p) => p.id === position.id);
    if (idx >= 0) {
      list[idx] = position;
    } else {
      list.push(position);
    }
    this.positionsByAsset.set(position.assetId, list);
  }

  /** Optional incremental helper when a position leaves the tracked set. */
  removePosition(positionId: number, assetId: string): void {
    const list = this.positionsByAsset.get(assetId);
    if (!list) return;
    const filtered = list.filter((p) => p.id !== positionId);
    if (filtered.length === 0) {
      this.positionsByAsset.delete(assetId);
    } else {
      this.positionsByAsset.set(assetId, filtered);
    }
  }

  /** Returns all asset IDs that currently have at least one tracked position. */
  getAllTrackedAssetIds(): string[] {
    return Array.from(this.positionsByAsset.keys());
  }
}
