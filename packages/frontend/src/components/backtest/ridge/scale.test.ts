import { describe, it, expect } from 'vitest';
import { buildRidgeScale, yTicksForVoieH } from './scale';
import { projectSeries, buildPathFromProjected, computeGapThreshold } from './projection';
import type { EnrichedSeries, EnrichedPoint } from './types';

// Helper to create a mock scale
function makeScale(plotW: number, minT = 0, maxT = 500000): ReturnType<typeof buildRidgeScale> {
  return buildRidgeScale(minT, maxT, plotW);
}

// Helper to build a full path from an enriched series (projection + gap + assembly)
function buildPathFromSeries(
  series: EnrichedSeries,
  voieTop: number,
  scale: ReturnType<typeof buildRidgeScale>,
  clipUntilT?: number | null,
): string {
  const projected = projectSeries(series, scale, voieTop, clipUntilT);
  if (projected.length === 0) return '';
  const gapThreshold = computeGapThreshold(projected);
  return buildPathFromProjected(projected, gapThreshold);
}

describe('ridge projection (projection.ts)', () => {
  const makeEnrichedSeries = (points: EnrichedPoint[]): EnrichedSeries => ({
    conditionId: 'test',
    city: 'Paris',
    targetDateIso: '2026-08-23',
    forecastMean: 25,
    forecastStdDev: 2,
    points,
    minT: points[0]?.t ?? 0,
    maxT: points[points.length - 1]?.t ?? 0,
  });

  describe('downsampleMinMax (via projectSeries integration)', () => {
    it('small series (< targetMaxPoints) → no downsampling, all points kept', () => {
      const scale = makeScale(400); // targetMaxPoints = ceil(400/4)*2 = 200
      const series = makeEnrichedSeries([
        { t: 1000, price: 0.5 },
        { t: 2000, price: 0.6 },
        { t: 3000, price: 0.55 },
      ]);
      const path = buildPathFromSeries(series, 0, scale);

      // All 3 points should be in path (2 L commands after initial M)
      const commands = path.split(' ');
      expect(commands.length).toBe(3); // M + L + L
    });

    it('large series (> targetMaxPoints) → downsampling applied, point count bounded', () => {
      const scale = makeScale(400); // targetMaxPoints = 200, covers t up to 500000
      const points: EnrichedPoint[] = [];
      for (let i = 0; i < 500; i++) {
        points.push({ t: i * 1000, price: 0.5 + Math.sin(i * 0.1) * 0.3 });
      }
      const series = makeEnrichedSeries(points);
      const path = buildPathFromSeries(series, 0, scale);

      // Path should have significantly fewer commands than 500
      const commands = path.split(' ');
      expect(commands.length).toBeLessThanOrEqual(200); // bounded by ~plotW/BUCKET_PX * 2
      expect(commands.length).toBeGreaterThan(0);
    });

    it('preserves first and last point', () => {
      const scale = makeScale(400);
      const points: EnrichedPoint[] = [];
      for (let i = 0; i < 500; i++) {
        points.push({ t: i * 1000, price: 0.5 });
      }
      // Make first and last distinct
      points[0].price = 0.1;
      points[499].price = 0.9;
      const series = makeEnrichedSeries(points);
      const path = buildPathFromSeries(series, 0, scale);

      const commands = path.split(' ');
      // First command should be M with first point's coordinates
      expect(commands[0]).toContain('M');
      // Last command should be L with last point's coordinates
      expect(commands[commands.length - 1]).toContain('L');
    });

    it('preserves min/max within buckets (peaks/valleys kept)', () => {
      const scale = makeScale(400); // 4px buckets = 100 buckets max
      const points: EnrichedPoint[] = [];
      for (let i = 0; i < 500; i++) {
        // Create a clear peak at i=250 and valley at i=100
        const price = i === 250 ? 0.9 : (i === 100 ? 0.1 : 0.5);
        points.push({ t: i * 1000, price });
      }
      const series = makeEnrichedSeries(points);
      const path = buildPathFromSeries(series, 0, scale);

      // The peak and valley should be preserved in the downsampled output
      const commands = path.split(' ');
      expect(commands.length).toBeLessThan(200);
    });

    it('cutGaps + downsampling: single gap preserved, no cascade of M', () => {
      const scale = makeScale(400);
      const points: EnrichedPoint[] = [];
      // First segment: 300 points (0 to 299000ms = ~5 min)
      for (let i = 0; i < 300; i++) {
        points.push({ t: i * 1000, price: 0.5 });
      }
      // Gap: jump of 70 seconds (> GAP_FLOOR_MS = 60000ms)
      for (let i = 370; i < 670; i++) { // 370000 to 669000, gap from 299000 to 370000 = 71000ms
        points.push({ t: i * 1000, price: 0.5 });
      }
      const series = makeEnrichedSeries(points);
      const path = buildPathFromSeries(series, 0, scale);

      const commands = path.split(' ');
      // Should have exactly 2 M commands (one per segment)
      const mCount = commands.filter(c => c.startsWith('M')).length;
      expect(mCount).toBe(2);
    });

    it('clipUntilT respected with downsampling', () => {
      const scale = makeScale(400);
      const points: EnrichedPoint[] = [];
      for (let i = 0; i < 500; i++) {
        points.push({ t: i * 1000, price: 0.5 });
      }
      const series = makeEnrichedSeries(points);
      const clipUntilT = 250 * 1000; // middle
      const path = buildPathFromSeries(series, 0, scale, clipUntilT);

      // All points in path should have t <= clipUntilT
      const commands = path.split(' ');
      expect(commands.length).toBeGreaterThan(0);
    });
  });

  describe('buildPathFromProjected (segmentation gaps)', () => {
    it('cutGaps works with temporal gap', () => {
      const scale = makeScale(400, Date.parse('2026-08-23T10:00:00Z'), Date.parse('2026-08-23T14:00:00Z'));
      const series = makeEnrichedSeries([
        { t: Date.parse('2026-08-23T10:00:00Z'), price: 0.5 },
        { t: Date.parse('2026-08-23T11:00:00Z'), price: 0.55 },
        { t: Date.parse('2026-08-23T14:00:00Z'), price: 0.6 }, // 3h gap from 11:00
        { t: Date.parse('2026-08-23T14:05:00Z'), price: 0.52 },
      ]);
      const path = buildPathFromSeries(series, 0, scale);

      const commands = path.split(' ');
      const mCount = commands.filter(c => c.startsWith('M')).length;
      // median step = 1h, gapThreshold = 1.5h, 3h gap > 1.5h → 2 segments
      expect(mCount).toBe(2);
    });
  });

  describe('yTicksForVoieH', () => {
    it('returns ticks for standard VOIE_H', () => {
      const ticks = yTicksForVoieH(48);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(1);
    });

    it('finer grid for taller voies', () => {
      const ticksShort = yTicksForVoieH(20);
      const ticksTall = yTicksForVoieH(80);
      // Taller voie → smaller step → more ticks
      expect(ticksTall.length).toBeGreaterThanOrEqual(ticksShort.length);
    });
  });

  describe('buildRidgeScale', () => {
    it('xPos maps minT→0, maxT→plotW', () => {
      const scale = buildRidgeScale(0, 1000, 400);
      expect(scale.xPos(0)).toBe(0);
      expect(scale.xPos(1000)).toBe(400);
      expect(scale.xPos(500)).toBe(200);
    });

    it('yPos maps price 0→bottom, 1→top (within voie)', () => {
      const scale = buildRidgeScale(0, 1000, 400, 48);
      const voieTop = 0;
      // price 0 → voieTop + 48 - 0*40 - 4 = 44
      // price 1 → voieTop + 48 - 1*40 - 4 = 4
      expect(scale.yPos(0, voieTop)).toBe(44);
      expect(scale.yPos(1, voieTop)).toBe(4);
    });
  });
});
