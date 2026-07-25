import type { AlgoSignal, AbstainReasonCode } from './strategy/strategy.js';

export interface SignalStateEntry {
  outcome: 'YES' | 'NO';
  confidence: number;
  strategyId: string;
  atMs: number;
}

export interface AbstainStateEntry {
  reason: AbstainReasonCode;
  /** Optional detail; persisted as `reason:detail` when present. */
  detail?: string;
  atMs: number;
}

/**
 * In-memory last signal / abstain per conditionId, snapshotted into price ticks.
 */
export class SignalStateRegistry {
  private readonly byCondition = new Map<string, SignalStateEntry>();
  private readonly abstainByCondition = new Map<string, AbstainStateEntry>();

  recordSignal(signal: AlgoSignal): void {
    this.byCondition.set(signal.conditionId, {
      outcome: signal.outcome,
      confidence: signal.confidence,
      strategyId: signal.strategyId,
      atMs: Date.now(),
    });
    // A successful signal clears the last abstain for this condition.
    this.abstainByCondition.delete(signal.conditionId);
  }

  recordAbstain(
    conditionId: string,
    reason: AbstainReasonCode,
    detail?: string,
  ): void {
    this.abstainByCondition.set(conditionId, {
      reason,
      detail,
      atMs: Date.now(),
    });
  }

  getLast(conditionId: string): SignalStateEntry | null {
    return this.byCondition.get(conditionId) ?? null;
  }

  getLastAbstain(conditionId: string): AbstainStateEntry | null {
    return this.abstainByCondition.get(conditionId) ?? null;
  }

  /** Persistable abstain label: `reason` or `reason:detail` (bounded). */
  formatAbstainReason(entry: AbstainStateEntry): string {
    if (!entry.detail) return entry.reason;
    const combined = `${entry.reason}:${entry.detail}`;
    return combined.length > 120 ? combined.slice(0, 120) : combined;
  }

  remove(conditionId: string): void {
    this.byCondition.delete(conditionId);
    this.abstainByCondition.delete(conditionId);
  }

  clear(): void {
    this.byCondition.clear();
    this.abstainByCondition.clear();
  }
}
