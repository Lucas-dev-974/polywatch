import { createBackendClient, type AlgoChartTickUpdate } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'crypto-algo:chart-tick-publisher' });

/**
 * Pushes live chart tick updates to the backend for WebSocket broadcast
 * to connected frontend clients viewing the market chart dialog.
 */
export class AlgoChartTickPublisher {
  private readonly postBackendJson: ReturnType<
    typeof createBackendClient
  >['postBackendJson'];

  constructor(backendUrl: string, serviceToken: string) {
    ({ postBackendJson: this.postBackendJson } = createBackendClient({
      backendUrl,
      serviceToken,
    }));
  }

  pushTick(tick: AlgoChartTickUpdate): void {
    void this.postTick(tick);
  }

  private async postTick(tick: AlgoChartTickUpdate): Promise<void> {
    try {
      const res = await this.postBackendJson('/api/internal/algo-chart-ticks', {
        tick,
      });
      if (!res.ok) {
        log.warn(
          { status: res.status, conditionId: tick.conditionId },
          'failed to push algo chart tick',
        );
      }
    } catch (err) {
      log.warn({ err, conditionId: tick.conditionId }, 'failed to push algo chart tick');
    }
  }
}
