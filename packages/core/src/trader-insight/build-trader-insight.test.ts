import { describe, expect, it } from 'vitest';
import {
  buildActivitySummary,
  buildActivityTimeline,
  buildMarketBreakdown,
  buildRecentActivity,
  filterTradeActivities,
  regularityLabelFr,
  resolveRegularityLabel,
} from './build-trader-insight.js';

function trade(
  partial: Partial<{
    timestamp: number;
    conditionId: string;
    usdcSize: number;
    title: string;
    type: string;
  }> & { timestamp: number },
) {
  return {
    conditionId: '0xabc',
    type: 'TRADE',
    usdcSize: 100,
    title: 'Will X happen?',
    ...partial,
  };
}

describe('buildActivitySummary', () => {
  it('returns empty summary when no trades', () => {
    const summary = buildActivitySummary([]);
    expect(summary.totalTrades).toBe(0);
    expect(summary.regularityLabel).toBe('sporadic');
  });

  it('computes regularity from weekly activity', () => {
    const week1 = Date.parse('2026-01-05T12:00:00.000Z') / 1000;
    const week2 = Date.parse('2026-01-12T12:00:00.000Z') / 1000;
    const week3 = Date.parse('2026-01-19T12:00:00.000Z') / 1000;
    const week4 = Date.parse('2026-01-26T12:00:00.000Z') / 1000;

    const summary = buildActivitySummary([
      trade({ timestamp: week1 }),
      trade({ timestamp: week2 }),
      trade({ timestamp: week3 }),
      trade({ timestamp: week4 }),
    ]);

    expect(summary.totalTrades).toBe(4);
    expect(summary.activeWeeks).toBe(4);
    expect(summary.totalWeeks).toBe(4);
    expect(summary.regularityScore).toBe(100);
    expect(summary.regularityLabel).toBe('very_regular');
  });

  it('detects sporadic activity across gaps', () => {
    const week1 = Date.parse('2026-01-05T12:00:00.000Z') / 1000;
    const week8 = Date.parse('2026-02-23T12:00:00.000Z') / 1000;

    const summary = buildActivitySummary([
      trade({ timestamp: week1 }),
      trade({ timestamp: week8 }),
    ]);

    expect(summary.activeWeeks).toBe(2);
    expect(summary.totalWeeks).toBeGreaterThan(2);
    expect(summary.regularityScore).toBeLessThan(40);
    expect(summary.longestGapDays).toBeGreaterThan(30);
  });
});

describe('buildActivityTimeline', () => {
  it('groups trades by ISO week', () => {
    const week1 = Date.parse('2026-01-05T12:00:00.000Z') / 1000;
    const week1b = Date.parse('2026-01-06T12:00:00.000Z') / 1000;
    const week2 = Date.parse('2026-01-12T12:00:00.000Z') / 1000;

    const timeline = buildActivityTimeline([
      trade({ timestamp: week1, usdcSize: 50 }),
      trade({ timestamp: week1b, usdcSize: 75 }),
      trade({ timestamp: week2, usdcSize: 200 }),
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.tradeCount).toBe(2);
    expect(timeline[0]!.volumeUsdc).toBe(125);
    expect(timeline[1]!.tradeCount).toBe(1);
  });
});

describe('buildMarketBreakdown', () => {
  it('aggregates trades by resolved category', () => {
    const meta = new Map([
      [
        '0xpol',
        {
          conditionId: '0xpol',
          tagSlugs: ['politics'],
          category: 'Politics',
          question: 'Election?',
        },
      ],
      [
        '0xsport',
        {
          conditionId: '0xsport',
          tagSlugs: ['sports', 'nba'],
          category: 'Sports',
          question: 'NBA game?',
        },
      ],
    ]);

    const rows = buildMarketBreakdown(
      [
        trade({ timestamp: 1, conditionId: '0xpol', usdcSize: 100 }),
        trade({ timestamp: 2, conditionId: '0xpol', usdcSize: 50 }),
        trade({ timestamp: 3, conditionId: '0xsport', usdcSize: 200 }),
      ],
      meta,
    );

    const politics = rows.find((r) => r.slug === 'politics');
    const sports = rows.find((r) => r.slug === 'sports');
    expect(politics?.tradeCount).toBe(2);
    expect(politics?.volumeUsdc).toBe(150);
    expect(sports?.tradeCount).toBe(1);
  });
});

describe('buildRecentActivity', () => {
  it('sorts by timestamp desc and limits rows', () => {
    const rows = buildRecentActivity(
      [
        trade({ timestamp: 100, title: 'Old' }),
        trade({ timestamp: 300, title: 'New' }),
        trade({ timestamp: 200, title: 'Mid' }),
      ],
      2,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toContain('New');
    expect(rows[1]!.title).toContain('Mid');
  });
});

describe('filterTradeActivities', () => {
  it('keeps only TRADE rows', () => {
    const filtered = filterTradeActivities([
      trade({ type: 'TRADE', timestamp: 1 }),
      trade({ type: 'REDEEM', timestamp: 2 }),
    ]);
    expect(filtered).toHaveLength(1);
  });
});

describe('regularity labels', () => {
  it('maps score thresholds', () => {
    expect(resolveRegularityLabel(80)).toBe('very_regular');
    expect(resolveRegularityLabel(50)).toBe('moderate');
    expect(resolveRegularityLabel(10)).toBe('sporadic');
    expect(regularityLabelFr('very_regular')).toBe('Très régulier');
  });
});
