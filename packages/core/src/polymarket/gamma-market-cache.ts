import { fetchGammaMarket, type GammaMarket } from './market-metadata.js';

/**
 * Intra-cycle cache for Gamma market fetches by conditionId.
 * Avoids duplicate API calls when disableResolved and active-selection
 * checks run in the same auto-track sync pass.
 */
export class GammaMarketCache {
  private readonly entries = new Map<string, GammaMarket | null>();

  /** Return cached value, or fetch from Gamma and store. */
  async get(conditionId: string): Promise<GammaMarket | null> {
    if (this.entries.has(conditionId)) {
      return this.entries.get(conditionId) ?? null;
    }

    const market = await fetchGammaMarket(conditionId);
    this.entries.set(conditionId, market);
    return market;
  }

  /** Store a value without fetching (e.g. after a direct fetch). */
  set(conditionId: string, market: GammaMarket | null): void {
    this.entries.set(conditionId, market);
  }

  has(conditionId: string): boolean {
    return this.entries.has(conditionId);
  }
}
