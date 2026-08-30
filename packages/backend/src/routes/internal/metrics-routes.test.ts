import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router, Request, Response } from 'express';
import { createInternalMetricsRouter } from './metrics-routes.js';
import * as metricsModule from '../../metrics.js';

/**
 * Helper: extract the POST handler for a given path from the router stack.
 */
function getPostHandler(router: Router, path: string) {
  for (const layer of router.stack) {
    const route = (layer as { route?: { path?: string; methods?: Record<string, boolean>; stack: [{ handle: (req: Request, res: Response) => void }] } }).route;
    if (route?.path === path && route?.methods?.post) {
      return route.stack[0].handle;
    }
  }
  return null;
}

describe('createInternalMetricsRouter', () => {
  let router: Router;
  let recordExitEventSpy: ReturnType<typeof vi.spyOn>;
  let recordStrategyCycleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    recordExitEventSpy = vi.spyOn(metricsModule, 'recordExitEvent').mockImplementation(() => {});
    recordStrategyCycleSpy = vi.spyOn(metricsModule, 'recordStrategyCycle').mockImplementation(() => {});
    router = createInternalMetricsRouter();
  });

  describe('POST /exit-event', () => {
    const handler = () => getPostHandler(router as unknown as Router, '/exit-event');

    it('returns 400 when reason is missing', () => {
      const h = handler();
      if (!h) { expect(true).toBe(false); return; }
      const status = vi.fn().mockReturnThis();
      const json = vi.fn().mockReturnThis();
      h({ body: {} }, { status, json });
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'missing or invalid reason' });
      expect(recordExitEventSpy).not.toHaveBeenCalled();
    });

    it('returns 400 when reason is not a string', () => {
      const h = handler();
      if (!h) { expect(true).toBe(false); return; }
      const status = vi.fn().mockReturnThis();
      const json = vi.fn().mockReturnThis();
      h({ body: { reason: 123 } }, { status, json });
      expect(status).toHaveBeenCalledWith(400);
    });

    it('calls recordExitEvent with valid reason', () => {
      const h = handler();
      if (!h) { expect(true).toBe(false); return; }
      const json = vi.fn().mockReturnThis();
      h({ body: { reason: 'SL' } }, { json });
      expect(recordExitEventSpy).toHaveBeenCalledWith('SL');
      expect(json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('POST /strategy-cycle', () => {
    const handler = () => getPostHandler(router as unknown as Router, '/strategy-cycle');

    it('returns 400 when durationMs is missing', () => {
      const h = handler();
      if (!h) { expect(true).toBe(false); return; }
      const status = vi.fn().mockReturnThis();
      const json = vi.fn().mockReturnThis();
      h({ body: {} }, { status, json });
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'missing or invalid durationMs' });
    });

    it('calls recordStrategyCycle with valid body', () => {
      const h = handler();
      if (!h) { expect(true).toBe(false); return; }
      const json = vi.fn().mockReturnThis();
      h({
        body: {
          durationMs: 42,
          positionsEvaluated: 10,
          positionsOpen: 5,
          positionsOpenByMode: { sim: 3, real: 2 },
          positionsByStatus: { open: 5 },
          illiquidPositions: 1,
          spreadMean: 0.05,
        },
      }, { json });
      expect(recordStrategyCycleSpy).toHaveBeenCalledWith({
        durationMs: 42,
        positionsEvaluated: 10,
        positionsOpen: 5,
        positionsOpenByMode: { sim: 3, real: 2 },
        positionsByStatus: { open: 5 },
        illiquidPositions: 1,
        spreadMean: 0.05,
      });
      expect(json).toHaveBeenCalledWith({ ok: true });
    });
  });
});
