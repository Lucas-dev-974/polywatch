import { describe, expect, it } from 'vitest';
import {
  buildConfigDiffPreviewLines,
  buildSnapshotConfigDiff,
  groupConfigDiffPreviewLines,
} from './snapshot-config-diff';

describe('buildSnapshotConfigDiff', () => {
  it('returns empty when fewer than 2 snapshots', () => {
    expect(
      buildSnapshotConfigDiff('sim', [{ snapshotId: 1, config: { simSizingMode: 'fixed_pusd' } }]),
    ).toEqual([]);
  });

  it('returns only differing keys', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      {
        snapshotId: 1,
        config: { simSlPercent: 10, simTpPercent: 12, simSizingMode: 'fixed_pusd' },
      },
      {
        snapshotId: 2,
        config: { simSlPercent: 20, simTpPercent: 12, simSizingMode: 'fixed_pusd' },
      },
    ]);
    expect(rows.some((r) => r.key === 'simSlPercent')).toBe(true);
    expect(rows.some((r) => r.key === 'simTpPercent')).toBe(false);
    expect(rows.some((r) => r.key === 'simSizingMode')).toBe(false);
  });

  it('detects boolean and tag array differences', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      {
        snapshotId: 1,
        config: {
          simTrailingEnabled: false,
          simAllowedMarketTags: ['crypto'],
        },
      },
      {
        snapshotId: 2,
        config: {
          simTrailingEnabled: true,
          simAllowedMarketTags: ['crypto', 'politics'],
        },
      },
    ]);
    expect(rows.some((r) => r.key === 'simTrailingEnabled')).toBe(true);
    expect(rows.some((r) => r.key === 'simAllowedMarketTags')).toBe(true);
  });

  it('uses legacy simSlTpEnabled for SL/TP enabled comparison', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      { snapshotId: 1, config: { simSlTpEnabled: true, simSlPercent: 10 } },
      { snapshotId: 2, config: { simSlEnabled: false, simTpEnabled: true, simSlPercent: 10 } },
    ]);
    expect(rows.some((r) => r.key === 'simSlEnabled')).toBe(true);
  });

  it('supports real mode keys', () => {
    const rows = buildSnapshotConfigDiff('real', [
      { snapshotId: 1, config: { realSlPercent: 10 } },
      { snapshotId: 2, config: { realSlPercent: 20 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('realSlPercent');
  });

  it('skips algo keys when absent from legacy snapshots', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      { snapshotId: 1, config: { simSlPercent: 10 } },
      {
        snapshotId: 2,
        config: {
          simSlPercent: 10,
          cryptoAlgoBaseThreshold: 0.55,
        },
      },
    ]);
    expect(rows.some((r) => r.key === 'cryptoAlgoBaseThreshold')).toBe(false);
  });

  it('diffs crypto algo when all snapshots include the key', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      {
        snapshotId: 1,
        config: { cryptoAlgoBaseThreshold: 0.55, cryptoAlgoSlPercent: 20 },
      },
      {
        snapshotId: 2,
        config: { cryptoAlgoBaseThreshold: 0.6, cryptoAlgoSlPercent: 20 },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('cryptoAlgoBaseThreshold');
    expect(rows[0]?.group).toBe('crypto_algo');
  });

  it('includes slConfirmationTicks at most once', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      { snapshotId: 1, config: { slConfirmationTicks: 2 } },
      { snapshotId: 2, config: { slConfirmationTicks: 5 } },
    ]);
    expect(rows.filter((r) => r.key === 'slConfirmationTicks')).toHaveLength(1);
  });
});

describe('buildConfigDiffPreviewLines', () => {
  it('formats pairwise diff as ref → value on the other entity', () => {
    const snaps = [
      {
        snapshotId: 1,
        config: { simSlPercent: 10, simTpPercent: 30 },
      },
      {
        snapshotId: 2,
        config: { simSlPercent: 20, simTpPercent: 30 },
      },
    ];
    const onOther = buildConfigDiffPreviewLines('sim', snaps, 2, 1);
    expect(onOther).toHaveLength(1);
    expect(onOther[0]?.key).toBe('simSlPercent');
    expect(onOther[0]?.changeLabel).toBe('10 → 20');

    const onRef = buildConfigDiffPreviewLines('sim', snaps, 1, 1);
    expect(onRef).toHaveLength(1);
    expect(onRef[0]?.changeLabel).toBe('10');
  });

  it('supports N-way compare and only lists keys that differ across the set', () => {
    const snaps = [
      { snapshotId: 1, config: { simSlPercent: 10, simTpPercent: 30 } },
      { snapshotId: 2, config: { simSlPercent: 20, simTpPercent: 30 } },
      { snapshotId: 3, config: { simSlPercent: 10, simTpPercent: 40 } },
    ];
    const on2 = buildConfigDiffPreviewLines('sim', snaps, 2, 1);
    expect(on2.map((l) => l.key).sort()).toEqual([
      'simSlPercent',
      'simTpPercent',
    ]);
    expect(on2.find((l) => l.key === 'simSlPercent')?.changeLabel).toBe(
      '10 → 20',
    );
    expect(on2.find((l) => l.key === 'simTpPercent')?.changeLabel).toBe('30');

    const on3 = buildConfigDiffPreviewLines('sim', snaps, 3, 1);
    expect(on3.find((l) => l.key === 'simSlPercent')?.changeLabel).toBe('10');
    expect(on3.find((l) => l.key === 'simTpPercent')?.changeLabel).toBe(
      '30 → 40',
    );
  });

  it('includes group on preview lines', () => {
    const snaps = [
      { snapshotId: 1, config: { cryptoAlgoBaseThreshold: 0.55 } },
      { snapshotId: 2, config: { cryptoAlgoBaseThreshold: 0.6 } },
    ];
    const lines = buildConfigDiffPreviewLines('sim', snaps, 2, 1);
    expect(lines[0]?.group).toBe('crypto_algo');
  });

  it('groups preview lines by group', () => {
    const lines = [
      { key: 'a', label: 'A', group: 'exit' as const, value: '1', changeLabel: '1' },
      { key: 'b', label: 'B', group: 'crypto_algo' as const, value: '2', changeLabel: '2' },
      { key: 'c', label: 'C', group: 'exit' as const, value: '3', changeLabel: '3' },
    ];
    const grouped = groupConfigDiffPreviewLines(lines);
    expect(grouped.map(([g]) => g)).toEqual(['exit', 'crypto_algo']);
    expect(grouped[0][1]).toHaveLength(2);
    expect(grouped[1][1]).toHaveLength(1);
  });

  it('normalizes nested JSON objects stably', () => {
    const snaps = [
      {
        snapshotId: 1,
        config: {
          cryptoAlgoExitDefaultsByInterval: {
            '5m': { slPercent: 20, tpPercent: 25 },
            '1h': { slPercent: 20, tpPercent: 25 },
          },
        },
      },
      {
        snapshotId: 2,
        config: {
          cryptoAlgoExitDefaultsByInterval: {
            '1h': { tpPercent: 25, slPercent: 20 },
            '5m': { tpPercent: 25, slPercent: 20 },
          },
        },
      },
    ];
    const rows = buildSnapshotConfigDiff('sim', snaps);
    expect(rows).toHaveLength(0);
  });
});
