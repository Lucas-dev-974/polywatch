import type { StrategyRegistry } from './registry.js';
import { NaiveMomentumStrategy } from './implementations/naive-momentum.strategy.js';

/**
 * Auto-register built-in strategies (Phase 2.4).
 * Add new strategies here — bootstrap only calls this once.
 */
export function registerBuiltinStrategies(registry: StrategyRegistry): void {
  registry.register(new NaiveMomentumStrategy());
}
