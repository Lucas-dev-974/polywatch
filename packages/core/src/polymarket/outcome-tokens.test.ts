import { describe, expect, it } from 'vitest';

import {
  binaryPricesFromParsed,
  binaryPricesToUpDown,
  displayLabelForAssetId,
  mapBinaryTokenSlots,
  mergeStableBinaryTokenSlots,
  outcomesFromPairsWithSlots,
  parseMarketOutcomes,
  serializeMarketOutcomes,
  toOutcomeSideLabels,
} from './outcome-tokens.js';

describe('mapBinaryTokenSlots', () => {
  it('maps Yes/No by alias', () => {
    expect(
      mapBinaryTokenSlots([
        { outcome: 'Yes', tokenId: '0xyes' },
        { outcome: 'No', tokenId: '0xno' },
      ]),
    ).toEqual({ tokenIdYes: '0xyes', tokenIdNo: '0xno' });
  });

  it('maps Up/Down by alias', () => {
    expect(
      mapBinaryTokenSlots([
        { outcome: 'Up', tokenId: '0xup' },
        { outcome: 'Down', tokenId: '0xdown' },
      ]),
    ).toEqual({ tokenIdYes: '0xup', tokenIdNo: '0xdown' });
  });

  it('uses pure index for custom labels', () => {
    expect(
      mapBinaryTokenSlots([
        { outcome: 'France', tokenId: '0xfr' },
        { outcome: 'Spain', tokenId: '0xes' },
      ]),
    ).toEqual({ tokenIdYes: '0xfr', tokenIdNo: '0xes' });
  });

  it('uses pure index when only one alias matches (no partial mix)', () => {
    expect(
      mapBinaryTokenSlots([
        { outcome: 'Spain', tokenId: '0xes' },
        { outcome: 'Yes', tokenId: '0xyes' },
      ]),
    ).toEqual({ tokenIdYes: '0xes', tokenIdNo: '0xyes' });
  });
});

describe('binaryPricesFromParsed', () => {
  it('resolves Yes/No by alias', () => {
    const result = binaryPricesFromParsed([
      { outcome: 'Yes', price: 0.62 },
      { outcome: 'No', price: 0.38 },
    ]);
    expect(result.side0?.outcome).toBe('Yes');
    expect(result.side1?.outcome).toBe('No');
  });

  it('falls back to index for France/Spain', () => {
    const result = binaryPricesFromParsed([
      { outcome: 'France', price: 0.55 },
      { outcome: 'Spain', price: 0.45 },
    ]);
    expect(result.side0?.outcome).toBe('France');
    expect(result.side1?.outcome).toBe('Spain');
    expect(binaryPricesToUpDown(result)).toEqual({
      upPrice: 0.55,
      downPrice: 0.45,
    });
  });

  it('returns nulls for a single outcome', () => {
    expect(binaryPricesFromParsed([{ outcome: 'France', price: 0.5 }])).toEqual({
      side0: null,
      side1: null,
    });
  });
});

describe('mergeStableBinaryTokenSlots', () => {
  it('preserves slots when Gamma permutes token order', () => {
    expect(
      mergeStableBinaryTokenSlots(
        { tokenIdYes: '0xfr', tokenIdNo: '0xes' },
        { tokenIdYes: '0xes', tokenIdNo: '0xfr' },
      ),
    ).toEqual({ tokenIdYes: '0xfr', tokenIdNo: '0xes' });
  });

  it('accepts fresh mapping when token set changes', () => {
    expect(
      mergeStableBinaryTokenSlots(
        { tokenIdYes: '0xold1', tokenIdNo: '0xold2' },
        { tokenIdYes: '0xnew1', tokenIdNo: '0xnew2' },
      ),
    ).toEqual({ tokenIdYes: '0xnew1', tokenIdNo: '0xnew2' });
  });
});

describe('outcomesFromPairsWithSlots', () => {
  it('assigns labels by tokenId after stable merge', () => {
    const pairs = [
      { outcome: 'Spain', tokenId: '0xes' },
      { outcome: 'France', tokenId: '0xfr' },
    ];
    const outcomes = outcomesFromPairsWithSlots(pairs, '0xfr', '0xes');
    expect(outcomes).toEqual([
      { label: 'France', tokenId: '0xfr', side: 0 },
      { label: 'Spain', tokenId: '0xes', side: 1 },
    ]);
    expect(toOutcomeSideLabels(outcomes)).toEqual({
      side0: 'France',
      side1: 'Spain',
    });
  });
});

describe('parseMarketOutcomes / serializeMarketOutcomes', () => {
  it('round-trips valid JSON', () => {
    const tokens = [
      { label: 'Over', tokenId: '0x1', side: 0 as const },
      { label: 'Under', tokenId: '0x2', side: 1 as const },
    ];
    const raw = serializeMarketOutcomes(tokens);
    expect(parseMarketOutcomes(raw)).toEqual(tokens);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseMarketOutcomes('not-json')).toEqual([]);
  });
});

describe('displayLabelForAssetId', () => {
  const outcomes = [
    { label: 'France', tokenId: '0xfr', side: 0 as const },
    { label: 'Spain', tokenId: '0xes', side: 1 as const },
  ];

  it('maps assetId to Gamma label', () => {
    expect(displayLabelForAssetId(outcomes, '0xfr', 'YES')).toBe('France');
  });

  it('falls back when assetId unknown', () => {
    expect(displayLabelForAssetId(outcomes, '0xunknown', 'YES')).toBe('YES');
  });
});
