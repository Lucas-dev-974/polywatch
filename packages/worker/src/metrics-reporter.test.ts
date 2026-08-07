import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsReporter } from './metrics-reporter.js';

const mockPostBackendJson = vi.hoisted(() => vi.fn());

vi.mock('./backend-client.js', () => ({
  postBackendJson: mockPostBackendJson,
}));

describe('MetricsReporter', () => {
  let reporter: MetricsReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new MetricsReporter();
  });

  describe('recordExit', () => {
    it('POSTs to /api/internal/metrics/exit-event with reason', async () => {
      mockPostBackendJson.mockResolvedValueOnce(undefined);
      await reporter.recordExit('SL');
      expect(mockPostBackendJson).toHaveBeenCalledWith(
        '/api/internal/metrics/exit-event',
        { reason: 'SL' },
      );
    });

    it('does not throw on network error', async () => {
      mockPostBackendJson.mockRejectedValueOnce(new Error('network error'));
      await expect(reporter.recordExit('TP')).resolves.toBeUndefined();
    });

    it('POSTs for all exit reasons', async () => {
      mockPostBackendJson.mockResolvedValue(undefined);
      const reasons = ['SL', 'TP', 'TRAILING', 'PRE_CLOSE_LOSS', 'PRE_CLOSE_WIN', 'KILL_SWITCH'];
      for (const reason of reasons) {
        await reporter.recordExit(reason);
      }
      expect(mockPostBackendJson).toHaveBeenCalledTimes(6);
    });
  });

  describe('pushStrategyCycle', () => {
    it('POSTs to /api/internal/metrics/strategy-cycle with snapshot', async () => {
      mockPostBackendJson.mockResolvedValueOnce(undefined);
      const snapshot = {
        durationMs: 42,
        positionsEvaluated: 10,
        positionsOpen: 5,
        positionsOpenByMode: { sim: 3, real: 2 },
        positionsByStatus: { open: 5, closing: 3 },
        illiquidPositions: 1,
        spreadMean: 0.05,
      };
      await reporter.pushStrategyCycle(snapshot);
      expect(mockPostBackendJson).toHaveBeenCalledWith(
        '/api/internal/metrics/strategy-cycle',
        snapshot,
      );
    });

    it('does not throw on network error', async () => {
      mockPostBackendJson.mockRejectedValueOnce(new Error('network error'));
      await expect(
        reporter.pushStrategyCycle({
          durationMs: 0,
          positionsEvaluated: 0,
          positionsOpen: 0,
          positionsOpenByMode: {},
          positionsByStatus: {},
          illiquidPositions: 0,
          spreadMean: 0,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
