import { describe, expect, it } from 'vitest';
import {
  COMPARE_ROWS,
  isSnapshotSimSlEnabled,
  isSnapshotSimTpEnabled,
} from './sim-snapshot-compare';

describe('isSnapshotSimSlEnabled / isSnapshotSimTpEnabled', () => {
  it('prefers split flags over legacy coupled toggle', () => {
    expect(
      isSnapshotSimSlEnabled({
        simSlEnabled: false,
        simSlTpEnabled: true,
      }),
    ).toBe(false);
    expect(
      isSnapshotSimTpEnabled({
        simTpEnabled: false,
        simSlTpEnabled: true,
      }),
    ).toBe(false);
  });

  it('falls back to legacy simSlTpEnabled when split flags are absent', () => {
    expect(isSnapshotSimSlEnabled({ simSlTpEnabled: true })).toBe(true);
    expect(isSnapshotSimTpEnabled({ simSlTpEnabled: true })).toBe(true);
    expect(isSnapshotSimSlEnabled({ simSlTpEnabled: false })).toBe(false);
    expect(isSnapshotSimTpEnabled({})).toBe(false);
  });
});

describe('COMPARE_ROWS SL/TP format', () => {
  const slRow = COMPARE_ROWS.find((r) => r.id === 'sl');
  const tpRow = COMPARE_ROWS.find((r) => r.id === 'tp');

  it('SL/TP percent rows are removed', () => {
    expect(slRow).toBeUndefined();
    expect(tpRow).toBeUndefined();
  });
});
