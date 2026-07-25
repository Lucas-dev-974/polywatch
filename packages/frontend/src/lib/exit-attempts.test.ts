import { describe, expect, it } from 'vitest';
import {
  exitAttemptBreakdownRows,
  formatExitAttemptDetail,
  formatSlAttemptMarkerLabel,
  summarizeExitAttempts,
  type ExitAttemptEvent,
} from './exit-attempts';
import { buildSlExitAttemptMarkers } from './updown-chart-overlays';

function event(
  overrides: Partial<ExitAttemptEvent> &
    Pick<ExitAttemptEvent, 'id' | 'kind' | 'closeReason' | 'createdAt'>,
): ExitAttemptEvent {
  return {
    copiedPositionId: 1,
    blockReason: null,
    error: null,
    executionId: null,
    ...overrides,
  };
}

describe('exit-attempts helpers', () => {
  it('summarizes kinds and close reasons', () => {
    const items = [
      event({
        id: 1,
        kind: 'emit_blocked',
        closeReason: 'SL',
        blockReason: 'no_close_bid',
        markBid: 0.41,
        createdAt: '2026-07-09T12:00:00.000Z',
      }),
      event({
        id: 2,
        kind: 'execution_failed',
        closeReason: 'TP',
        error: 'no_liquidity',
        createdAt: '2026-07-09T12:01:00.000Z',
      }),
      event({
        id: 3,
        kind: 'emit_blocked',
        closeReason: 'SL',
        blockReason: 'no_close_bid',
        createdAt: '2026-07-09T12:02:00.000Z',
      }),
    ];
    const summary = summarizeExitAttempts(items);
    expect(summary.emitBlocked).toBe(2);
    expect(summary.executionFailed).toBe(1);
    expect(summary.byCloseReason).toEqual({ SL: 2, TP: 1 });
    expect(summary.last?.id).toBe(3);
    expect(exitAttemptBreakdownRows(summary.byCloseReason)).toEqual([
      { reason: 'SL', count: 2 },
      { reason: 'TP', count: 1 },
    ]);
    expect(formatExitAttemptDetail(items[0]!)).toBe('SL / no_close_bid @ 41.0¢');
    expect(formatSlAttemptMarkerLabel(items[0]!)).toBe(
      'SL / no_close_bid @ 41.0¢',
    );
  });
});

describe('buildSlExitAttemptMarkers', () => {
  it('keeps only SL events inside the chart window and carries markBid', () => {
    const markers = buildSlExitAttemptMarkers(
      [
        event({
          id: 1,
          kind: 'emit_blocked',
          closeReason: 'SL',
          blockReason: 'no_close_bid',
          createdAt: '2026-07-09T11:59:00.000Z',
        }),
        event({
          id: 2,
          kind: 'emit_blocked',
          closeReason: 'SL',
          blockReason: 'no_close_bid',
          markBid: 0.37,
          createdAt: '2026-07-09T12:00:30.000Z',
        }),
        event({
          id: 3,
          kind: 'execution_failed',
          closeReason: 'TP',
          error: 'no_liquidity',
          createdAt: '2026-07-09T12:00:40.000Z',
        }),
        event({
          id: 4,
          kind: 'execution_failed',
          closeReason: 'SL',
          error: 'no_liquidity',
          createdAt: '2026-07-09T12:02:00.000Z',
        }),
      ],
      Date.parse('2026-07-09T12:00:00.000Z'),
      Date.parse('2026-07-09T12:01:00.000Z'),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.kind).toBe('emit_blocked');
    expect(markers[0]!.t).toBe(Date.parse('2026-07-09T12:00:30.000Z'));
    expect(markers[0]!.markBid).toBeCloseTo(0.37);
  });
});
