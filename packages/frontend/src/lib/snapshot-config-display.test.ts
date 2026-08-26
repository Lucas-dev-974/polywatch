import { describe, expect, it } from 'vitest';
import {
  formatSnapshotConfigValue,
  groupSnapshotConfigEntries,
} from './snapshot-config-display';

describe('snapshot-config-display', () => {
  it('formats objects as JSON', () => {
    expect(formatSnapshotConfigValue({ '5m': 0.05 })).toBe('{"5m":0.05}');
  });

  it('groups copy and algo keys into separate sections', () => {
    const sections = groupSnapshotConfigEntries({
      simSlPercent: 10,
      cryptoAlgoBaseThreshold: 0.55,
    });
    expect(sections.map((s) => s.title)).toEqual(['Copy · lane', 'Crypto Algo']);
    expect(sections[0]?.entries.some(([k]) => k === 'simSlPercent')).toBe(true);
    expect(sections[1]?.entries.some(([k]) => k === 'cryptoAlgoBaseThreshold')).toBe(
      true,
    );
  });
});
