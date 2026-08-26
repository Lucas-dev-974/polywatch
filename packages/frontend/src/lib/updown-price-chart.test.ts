import { describe, expect, it } from 'vitest';
import {
  UPDOWN_CHART_CONFIG,
  buildChartXTicks,
  buildPriceLinePath,
  computeUpDownPlotLayout,
  formatUpDownChartTime,
  resolveOutcomePrice,
  resolveOutcomeSide,
  interpolateOutcomePriceAtTime,
  computePositionLevelThresholds,
  resolveLevelLabelYs,
  formatUpDownPriceCents,
} from './updown-price-chart';
import type { UpDownPricePoint } from './market-chart';

const samplePoints: UpDownPricePoint[] = [
  { t: 1_000, up: 0.4, down: 0.6 },
  { t: 2_000, up: 0.55, down: 0.45 },
  { t: 3_000, up: 0.7, down: 0.3 },
];

describe('updown-price-chart', () => {
  it('exposes chart colors for stroke rendering', () => {
    expect(UPDOWN_CHART_CONFIG.colors.up).toBe('#34d399');
    expect(UPDOWN_CHART_CONFIG.colors.down).toBe('#f87171');
  });

  it('builds svg paths when at least two valid values exist', () => {
    const path = buildPriceLinePath(
      [
        { t: 1_000, v: 0.4 },
        { t: 2_000, v: 0.6 },
      ],
      1_000,
      2_000,
      500,
      100,
      16,
      40,
    );
    expect(path.startsWith('M')).toBe(true);
    expect(path.includes('L')).toBe(true);
  });

  it('derives the x domain from data points only', () => {
    const layout = computeUpDownPlotLayout(samplePoints);
    expect(layout?.minT).toBe(1_000);
    expect(layout?.maxT).toBe(3_000);
    expect(layout?.upPath.length).toBeGreaterThan(0);
    expect(layout?.downPath.length).toBeGreaterThan(0);
  });

  it('formats x-axis labels according to the displayed time span', () => {
    const t0 = Date.UTC(2026, 6, 13, 10, 0, 0);

    expect(formatUpDownChartTime(t0, 5 * 60_000)).toMatch(/\d{2}:\d{2}:\d{2}/);

    expect(formatUpDownChartTime(t0, 3_600_000)).toMatch(/\d{2}:\d{2}/);
    expect(formatUpDownChartTime(t0, 3_600_000)).not.toMatch(/\d{2}\/\d{2}/);

    const dayLabel = formatUpDownChartTime(t0, 24 * 3_600_000);
    expect(dayLabel).toMatch(/\d{2}\/\d{2}/);
    expect(dayLabel).toMatch(/\d{2}:\d{2}/);

    const monthLabel = formatUpDownChartTime(t0, 30 * 86_400_000);
    expect(monthLabel).toMatch(/\d{2}\/\d{2}/);
    expect(monthLabel).not.toMatch(/\d{2}:\d{2}/);
  });

  it('keeps distinct x-axis labels across a multi-day span', () => {
    const start = Date.UTC(2026, 6, 10, 12, 0, 0);
    const end = Date.UTC(2026, 6, 13, 12, 0, 0);
    const ticks = buildChartXTicks(start, end);
    const labels = ticks.map((tick) => tick.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.every((label) => /\d{2}\/\d{2}/.test(label))).toBe(true);
  });

  it('aligns x-axis ticks on round time steps', () => {
    // Données 15 min : premier point à 10:07:30, span de 24 h.
    const start = Date.UTC(2026, 6, 13, 10, 7, 30);
    const end = start + 24 * 3_600_000;
    const ticks = buildChartXTicks(start, end);
    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) {
      const d = new Date(tick.t);
      // Ticks alignés sur des heures pleines (pas de minutes parasites).
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  it('aligns x-axis ticks on 15-minute boundaries for short spans', () => {
    // Span de 2 h : pas de 15 min attendu, ticks sur :00/:15/:30/:45.
    const start = Date.UTC(2026, 6, 13, 10, 7, 30);
    const end = start + 2 * 3_600_000;
    const ticks = buildChartXTicks(start, end);
    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) {
      const d = new Date(tick.t);
      expect(d.getUTCMinutes() % 15).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  it('reduces tick count when the plot is narrow', () => {
    const start = Date.UTC(2026, 6, 13, 0, 0, 0);
    const end = start + 24 * 3_600_000;
    const wide = buildChartXTicks(start, end, 6, 600);
    const narrow = buildChartXTicks(start, end, 6, 120);
    expect(narrow.length).toBeLessThanOrEqual(wide.length);
    expect(narrow.length).toBeGreaterThanOrEqual(2);
  });

  it('formats prices as cents', () => {
    expect(formatUpDownPriceCents(0.455)).toBe('45.5\u00A2');
    expect(formatUpDownPriceCents(null)).toBe('N/A');
  });

  it('resolves curve price from outcome', () => {
    const point: UpDownPricePoint = { t: 1_000, up: 0.4, down: 0.6 };
    expect(resolveOutcomePrice(point, 'Up')).toBe(0.4);
    expect(resolveOutcomePrice(point, 'Down')).toBe(0.6);
    expect(resolveOutcomePrice(point, 'Yes')).toBe(0.4);
    expect(resolveOutcomePrice(point, 'NO')).toBe(0.6);
    expect(resolveOutcomePrice(point, 'France', { side0: 'France', side1: 'Spain' })).toBe(
      0.4,
    );
    expect(resolveOutcomePrice(point, 'Spain', { side0: 'France', side1: 'Spain' })).toBe(
      0.6,
    );
    expect(resolveOutcomePrice({ t: 1_000, up: 0.55, down: null }, null)).toBe(0.55);
  });

  it('resolveOutcomeSide maps yes/no aliases to curves', () => {
    expect(resolveOutcomeSide('NO')).toBe('down');
    expect(resolveOutcomeSide('yes')).toBe('up');
    expect(resolveOutcomeSide('Spain', { side0: 'France', side1: 'Spain' })).toBe('down');
  });

  it('interpolates curve price at target time', () => {
    const points: UpDownPricePoint[] = [
      { t: 1_000, up: 0.4, down: 0.6 },
      { t: 3_000, up: 0.6, down: 0.4 },
    ];
    expect(interpolateOutcomePriceAtTime(points, 2_000, 'Down')).toBe(0.5);
    expect(interpolateOutcomePriceAtTime(points, 500, 'Down')).toBe(0.6);
    expect(interpolateOutcomePriceAtTime(points, 4_000, 'Up')).toBe(0.6);
  });

  it('computes SL/TP thresholds in percentage mode', () => {
    expect(
      computePositionLevelThresholds({
        entryBidVwap: 0.78,
        costPerShare: 0.50,
        slPercent: 20,
        tpPercent: 25,
      }),
    ).toEqual({ entry: 0.78, sl: 0.4, tp: 0.625 });
  });

  it('falls back to no thresholds when percentages are absent', () => {
    expect(
      computePositionLevelThresholds({
        entryBidVwap: 0.50,
        costPerShare: 0.50,
      }),
    ).toEqual({ entry: 0.5, sl: null, tp: null });
  });

  it('staggers label Y positions when lines are close', () => {
    const labelYs = resolveLevelLabelYs([100, 108, 130], 12);
    expect(labelYs[0]).toBe(96);
    expect(labelYs[1]).toBeGreaterThanOrEqual(labelYs[0]! + 12);
  });

  it('preserves ascending order of staggered labels', () => {
    const labelYs = resolveLevelLabelYs([50, 52, 54, 200], 18);
    for (let i = 1; i < labelYs.length; i++) {
      expect(labelYs[i]).toBeGreaterThanOrEqual(labelYs[i - 1]! + 18);
    }
  });

  it('leaves well-separated labels untouched in relative ordering', () => {
    const labelYs = resolveLevelLabelYs([20, 100, 180], 18);
    expect(labelYs[0]).toBe(16);
    expect(labelYs[1]).toBe(96);
    expect(labelYs[2]).toBe(176);
  });
});
