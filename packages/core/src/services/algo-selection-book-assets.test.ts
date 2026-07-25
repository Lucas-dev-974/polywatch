import { describe, expect, it } from 'vitest';
import { mergeBookAssetMaps, type BookAssetMaps } from './algo-selection-book-assets.js';

function maps(
  assetIds: string[],
  entries: Array<[string, string, string]>,
): BookAssetMaps {
  const conditionIdByAssetId = new Map<string, string>();
  const outcomeByAssetId = new Map<string, string>();
  for (const [assetId, conditionId, outcome] of entries) {
    conditionIdByAssetId.set(assetId, conditionId);
    outcomeByAssetId.set(assetId, outcome);
  }
  return { assetIds, conditionIdByAssetId, outcomeByAssetId };
}

describe('mergeBookAssetMaps', () => {
  it('deduplicates asset ids across sources', () => {
    const a = maps(['t1', 't2'], [
      ['t1', '0xaaa', 'up'],
      ['t2', '0xaaa', 'down'],
    ]);
    const b = maps(['t2', 't3'], [
      ['t2', '0xbbb', 'up'],
      ['t3', '0xbbb', 'down'],
    ]);
    const merged = mergeBookAssetMaps(a, b);
    expect(merged.assetIds.sort()).toEqual(['t1', 't2', 't3']);
  });

  it('later source overrides metadata on collision', () => {
    const a = maps(['t1'], [['t1', '0xaaa', 'up']]);
    const b = maps(['t1'], [['t1', '0xbbb', 'down']]);
    const merged = mergeBookAssetMaps(a, b);
    expect(merged.conditionIdByAssetId.get('t1')).toBe('0xbbb');
    expect(merged.outcomeByAssetId.get('t1')).toBe('down');
  });
});
