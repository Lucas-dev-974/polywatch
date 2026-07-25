import { describe, expect, it } from 'vitest';
import {
  buildConfigDiffPreviewLines,
  buildSnapshotConfigDiff,
  groupConfigDiffPreviewLines,
} from './snapshot-config-diff';

describe('buildSnapshotConfigDiff', () => {
  it('returns empty when fewer than 2 snapshots', () => {
    expect(
      buildSnapshotConfigDiff('sim', [{ snapshotId: 1, config: { simSizingMode: 'fixed_usdc' } }]),
    ).toEqual([]);
  });

  it('returns only differing keys', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      {
        snapshotId: 1,
        config: { simSlBidPoints: 0.1, simTpBidPoints: 0.12, simSizingMode: 'fixed_usdc' },
      },
      {
        snapshotId: 2,
        config: { simSlBidPoints: 0.2, simTpBidPoints: 0.12, simSizingMode: 'fixed_usdc' },
      },
    ]);
    expect(rows.some((r) => r.key === 'simSlBidPoints')).toBe(true);
    expect(rows.some((r) => r.key === 'simTpBidPoints')).toBe(false);
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
      { snapshotId: 1, config: { simSlTpEnabled: true, simSlBidPoints: 0.1 } },
      { snapshotId: 2, config: { simSlEnabled: false, simTpEnabled: true, simSlBidPoints: 0.1 } },
    ]);
    expect(rows.some((r) => r.key === 'simSlEnabled')).toBe(true);
  });

  it('supports real mode keys', () => {
    const rows = buildSnapshotConfigDiff('real', [
      { snapshotId: 1, config: { realSlBidPoints: 0.1 } },
      { snapshotId: 2, config: { realSlBidPoints: 0.2 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('realSlBidPoints');
  });

  it('skips algo keys when absent from legacy snapshots', () => {
    const rows = buildSnapshotConfigDiff('sim', [
      { snapshotId: 1, config: { simSlBidPoints: 0.1 } },
      {
        snapshotId: 2,
        config: {
          simSlBidPoints: 0.1,
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
        config: { cryptoAlgoBaseThreshold: 0.55, cryptoAlgoSlBidPoints: 0.1 },
      },
      {
        snapshotId: 2,
        config: { cryptoAlgoBaseThreshold: 0.6, cryptoAlgoSlBidPoints: 0.1 },
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
        config: { simSlBidPoints: 0.1, simTpBidPoints: 0.3 },
      },
      {
        snapshotId: 2,
        config: { simSlBidPoints: 0.2, simTpBidPoints: 0.3 },
      },
    ];
    const onOther = buildConfigDiffPreviewLines('sim', snaps, 2, 1);
    expect(onOther).toHaveLength(1);
    expect(onOther[0]?.key).toBe('simSlBidPoints');
    expect(onOther[0]?.changeLabel).toBe('0.1 → 0.2');

    const onRef = buildConfigDiffPreviewLines('sim', snaps, 1, 1);
    expect(onRef).toHaveLength(1);
    expect(onRef[0]?.changeLabel).toBe('0.1');
  });

  it('supports N-way compare and only lists keys that differ across the set', () => {
    const snaps = [
      { snapshotId: 1, config: { simSlBidPoints: 0.1, simTpBidPoints: 0.3 } },
      { snapshotId: 2, config: { simSlBidPoints: 0.2, simTpBidPoints: 0.3 } },
      { snapshotId: 3, config: { simSlBidPoints: 0.1, simTpBidPoints: 0.4 } },
    ];
    const on2 = buildConfigDiffPreviewLines('sim', snaps, 2, 1);
    expect(on2.map((l) => l.key).sort()).toEqual([
      'simSlBidPoints',
      'simTpBidPoints',
    ]);
    expect(on2.find((l) => l.key === 'simSlBidPoints')?.changeLabel).toBe(
      '0.1 → 0.2',
    );
    expect(on2.find((l) => l.key === 'simTpBidPoints')?.changeLabel).toBe('0.3');

    const on3 = buildConfigDiffPreviewLines('sim', snaps, 3, 1);
    expect(on3.find((l) => l.key === 'simSlBidPoints')?.changeLabel).toBe('0.1');
    expect(on3.find((l) => l.key === 'simTpBidPoints')?.changeLabel).toBe(
      '0.3 → 0.4',
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
            '5m': { slBidPoints: 0.1, tpBidPoints: 0.12 },
            '1h': { slBidPoints: 0.1, tpBidPoints: 0.12 },
          },
        },
      },
      {
        snapshotId: 2,
        config: {
          cryptoAlgoExitDefaultsByInterval: {
            '1h': { tpBidPoints: 0.12, slBidPoints: 0.1 },
            '5m': { tpBidPoints: 0.12, slBidPoints: 0.1 },
          },
        },
      },
    ];
    const rows = buildSnapshotConfigDiff('sim', snaps);
    expect(rows).toHaveLength(0);
  });
});
