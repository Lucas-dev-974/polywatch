import type { DataSource } from 'typeorm';
import pino from 'pino';
import {
  aggregatePositionMetrics,
  loadAlgoPositionsByConditionIds,
  type PositionAggregateMetrics,
} from '@polywatch/core';

const log = pino({ name: 'crypto-algo:position-context-cache' });

const EMPTY_METRICS: PositionAggregateMetrics = {
  count: 0,
  exposureUsd: 0,
  unrealizedPnl: 0,
};

/**
 * Batch-refreshed open algo position metrics per conditionId.
 */
export class PositionContextCache {
  private readonly metricsByCondition = new Map<string, PositionAggregateMetrics>();
  private refreshInFlight: Promise<void> | null = null;
  /** ConditionIds queued for a deferred refresh after the in-flight one finishes. */
  private pendingConditionIds: string[] | null = null;

  constructor(private readonly ds: DataSource) {}

  getMetrics(conditionId: string): PositionAggregateMetrics {
    return this.metricsByCondition.get(conditionId) ?? EMPTY_METRICS;
  }

  async refresh(conditionIds: string[]): Promise<void> {
    if (conditionIds.length === 0) {
      this.metricsByCondition.clear();
      return;
    }

    if (this.refreshInFlight) {
      this.pendingConditionIds = conditionIds;
      await this.refreshInFlight;
      return;
    }

    this.refreshInFlight = this.doRefresh(conditionIds);
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }

    if (this.pendingConditionIds) {
      const next = this.pendingConditionIds;
      this.pendingConditionIds = null;
      await this.refresh(next);
    }
  }

  private async doRefresh(conditionIds: string[]): Promise<void> {
    try {
      const grouped = await loadAlgoPositionsByConditionIds(this.ds, conditionIds);
      const next = new Map<string, PositionAggregateMetrics>();

      for (const conditionId of conditionIds) {
        next.set(
          conditionId,
          aggregatePositionMetrics(grouped.get(conditionId) ?? []),
        );
      }

      this.metricsByCondition.clear();
      for (const [k, v] of next) {
        this.metricsByCondition.set(k, v);
      }
    } catch (err) {
      log.warn({ err }, 'failed to refresh position context cache');
    }
  }

  clear(): void {
    this.metricsByCondition.clear();
  }
}
