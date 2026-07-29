import type { CryptoAlgoStrategy } from './strategy.js';

/**
 * Registry of available crypto-algo strategies. Strategies are registered once
 * at bootstrap; callers filter to the active subset via `getActiveStrategies`
 * using the enabledIds from `CryptoConfig.cryptoAlgoStrategies`.
 */
export class StrategyRegistry {
  private readonly strategies = new Map<string, CryptoAlgoStrategy>();

  register(strategy: CryptoAlgoStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Returns strategies whose id is in `enabledIds`, preserving the order of
   * `enabledIds`. Unknown ids are silently skipped.
   */
  getActiveStrategies(enabledIds: string[]): CryptoAlgoStrategy[] {
    const out: CryptoAlgoStrategy[] = [];
    for (const id of enabledIds) {
      const s = this.strategies.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  getStrategy(id: string): CryptoAlgoStrategy | undefined {
    return this.strategies.get(id);
  }
}