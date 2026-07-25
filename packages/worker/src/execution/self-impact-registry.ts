import type { OrderBookLevel } from '@polywatch/core';
import { simulateFakFill } from '@polywatch/core';

type ImpactSlice = {
  price: number;
  size: number;
  expiresAt: number;
};

const MAX_ASSETS = 500;

export class SelfImpactRegistry {
  private byAsset = new Map<string, ImpactSlice[]>();

  constructor(private ttlMs: number) {}

  private purge(assetId: string, now: number): void {
    const slices = this.byAsset.get(assetId);
    if (!slices) return;
    const fresh = slices.filter((s) => s.expiresAt > now && s.size > 0);
    if (fresh.length === 0) {
      this.byAsset.delete(assetId);
    } else {
      this.byAsset.set(assetId, fresh);
    }
  }

  private evictIfNeeded(): void {
    if (this.byAsset.size <= MAX_ASSETS) return;
    const oldest = this.byAsset.keys().next().value;
    if (oldest !== undefined) this.byAsset.delete(oldest);
  }

  applyImpact(
    assetId: string,
    side: 'BUY' | 'SELL',
    levels: OrderBookLevel[],
  ): OrderBookLevel[] {
    const now = Date.now();
    this.purge(assetId, now);
    const slices = this.byAsset.get(assetId);
    if (!slices || slices.length === 0) return levels;

    return levels.map((level) => {
      let remaining = level.size;
      for (const slice of slices) {
        if (slice.expiresAt <= now) continue;
        if (Math.abs(slice.price - level.price) > 1e-9) continue;
        remaining -= slice.size;
      }
      return { price: level.price, size: Math.max(0, remaining) };
    }).filter((l) => l.size > 0);
  }

  recordFill(
    assetId: string,
    side: 'BUY' | 'SELL',
    levels: OrderBookLevel[],
    quantity: number,
    limitPrice: number,
  ): void {
    const fak = simulateFakFill(levels, quantity, limitPrice, side);
    if (fak.fillQuantity <= 0) return;

    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    let remaining = fak.fillQuantity;
    const ascending = side === 'BUY';
    const sorted = [...levels].sort((a, b) =>
      ascending ? a.price - b.price : b.price - a.price,
    );

    const slices = this.byAsset.get(assetId) ?? [];
    for (const level of sorted) {
      if (remaining <= 0) break;
      const withinLimit =
        side === 'BUY' ? level.price <= limitPrice : level.price >= limitPrice;
      if (!withinLimit) break;
      const take = Math.min(level.size, remaining);
      if (take > 0) {
        slices.push({ price: level.price, size: take, expiresAt });
        remaining -= take;
      }
    }

    this.byAsset.set(assetId, slices);
    this.evictIfNeeded();
  }
}

/** Process-wide registry — reset on worker restart (acceptable per plan). */
let sharedRegistry: SelfImpactRegistry | null = null;

export function getSelfImpactRegistry(ttlSeconds: number): SelfImpactRegistry {
  const ttlMs = Math.max(1, ttlSeconds) * 1000;
  if (!sharedRegistry || (sharedRegistry as { _ttlMs?: number })._ttlMs !== ttlMs) {
    const reg = new SelfImpactRegistry(ttlMs) as SelfImpactRegistry & {
      _ttlMs?: number;
    };
    reg._ttlMs = ttlMs;
    sharedRegistry = reg;
  }
  return sharedRegistry;
}

/** Test helper */
export function resetSelfImpactRegistryForTests(): void {
  sharedRegistry = null;
}
