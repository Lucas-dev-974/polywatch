import { postBackendJson } from './backend-client.js';

export interface StrategyCycleSnapshot {
  durationMs: number;
  positionsEvaluated: number;
  positionsOpen: number;
  positionsOpenByMode: Record<string, number>;
  positionsByStatus: Record<string, number>;
  illiquidPositions: number;
  spreadMean: number;
}

export class MetricsReporter {
  async recordExit(reason: string): Promise<void> {
    try {
      await postBackendJson('/api/internal/metrics/exit-event', { reason });
    } catch {
      // Metrics push failures are non-critical — silently ignore.
    }
  }

  async pushStrategyCycle(snapshot: StrategyCycleSnapshot): Promise<void> {
    try {
      await postBackendJson('/api/internal/metrics/strategy-cycle', snapshot);
    } catch {
      // Metrics push failures are non-critical — silently ignore.
    }
  }
}
