import { describe, expect, it } from 'vitest';
import {
  buildEntrySizingInput,
  computeEntryTargetQuantity,
  requiresTraderPortfolioValue,
  resolveCapitalForRatio,
  resolveRealEntryBalances,
} from './entry-sizing.js';

describe('requiresTraderPortfolioValue', () => {
  it('is true only for proportional_capital', () => {
    expect(requiresTraderPortfolioValue('proportional_capital')).toBe(true);
    expect(requiresTraderPortfolioValue('fixed_pusd')).toBe(false);
    expect(requiresTraderPortfolioValue('fixed_shares')).toBe(false);
    expect(requiresTraderPortfolioValue('fixed_ratio')).toBe(false);
  });
});

describe('resolveCapitalForRatio', () => {
  it('uses equity when provided for proportional_capital', () => {
    expect(
      resolveCapitalForRatio('proportional_capital', {
        cash: 5000,
        capitalForRatio: 10_000,
      }),
    ).toBe(10_000);
  });

  it('falls back to cash when capitalForRatio is absent', () => {
    expect(
      resolveCapitalForRatio('proportional_capital', { cash: 5000 }),
    ).toBe(5000);
  });

  it('returns undefined for non-proportional modes', () => {
    expect(
      resolveCapitalForRatio('fixed_ratio', { cash: 5000, capitalForRatio: 10_000 }),
    ).toBeUndefined();
  });
});

describe('resolveRealEntryBalances', () => {
  it('uses provided cash for proportional_capital', () => {
    expect(resolveRealEntryBalances('proportional_capital', 500)).toEqual({
      cash: 500,
      capitalForRatio: 500,
    });
  });

  it('uses provided cash for fixed modes', () => {
    expect(resolveRealEntryBalances('fixed_pusd', 2000)).toEqual({
      cash: 2000,
    });
  });
});

describe('computeEntryTargetQuantity', () => {
  it('delegates to computeTargetQuantity with built input', () => {
    const qty = computeEntryTargetQuantity({
      sizing: {
        sizingMode: 'fixed_ratio',
        copyRatio: 0.5,
        fixedPusdAmount: 10,
        fixedShareCount: 5,
        kellyFraction: 0.25,
        riskBudgetPusd: 10,
        defaultWinProbability: 0.55,
        signalScoreSizingEnabled: true,
      },
      askVwap: 0.5,
      traderDelta: 100,
      previousTraderSize: 0,
      balances: { cash: 10_000 },
      maxPositionSizePusd: 500,
    });
    expect(qty).toBeCloseTo(50, 2);
  });

  it('buildEntrySizingInput wires proportional fields', () => {
    const input = buildEntrySizingInput({
      sizing: {
        sizingMode: 'proportional_capital',
        copyRatio: 1,
        fixedPusdAmount: 10,
        fixedShareCount: 5,
        kellyFraction: 0.25,
        riskBudgetPusd: 10,
        defaultWinProbability: 0.55,
        signalScoreSizingEnabled: true,
      },
      askVwap: 0.5,
      traderDelta: 200,
      previousTraderSize: 0,
      balances: { cash: 5000, capitalForRatio: 10_000 },
      traderPortfolioValue: 20_000,
      maxPositionSizePusd: 10_000,
    });
    expect(input.userBalance).toBe(5000);
    expect(input.userCapital).toBe(10_000);
    expect(input.traderBalance).toBe(20_000);
  });

  it('ignores signal score multiplier when disabled in sizing params', () => {
    const input = buildEntrySizingInput({
      sizing: {
        sizingMode: 'fixed_pusd',
        copyRatio: 1,
        fixedPusdAmount: 1.5,
        fixedShareCount: 5,
        signalScoreSizingEnabled: false,
      },
      askVwap: 0.5,
      traderDelta: 100,
      previousTraderSize: 0,
      balances: { cash: 10_000 },
      maxPositionSizePusd: 500,
      signalScore: { score: 0.2, multiplier: 0.2, reasons: ['Wide spread'] },
    });
    expect(input.signalMultiplier).toBeUndefined();

    const qty = computeEntryTargetQuantity({
      sizing: {
        sizingMode: 'fixed_pusd',
        copyRatio: 1,
        fixedPusdAmount: 1.5,
        fixedShareCount: 5,
        signalScoreSizingEnabled: false,
      },
      askVwap: 0.5,
      traderDelta: 100,
      previousTraderSize: 0,
      balances: { cash: 10_000 },
      maxPositionSizePusd: 500,
      signalScore: { score: 0.2, multiplier: 0.2, reasons: ['Wide spread'] },
    });
    expect(qty).toBeCloseTo(3, 2);
  });

  it('buildEntrySizingInput wires fixedShareCount', () => {
    const input = buildEntrySizingInput({
      sizing: {
        sizingMode: 'fixed_shares',
        copyRatio: 1,
        fixedPusdAmount: 10,
        fixedShareCount: 7,
        signalScoreSizingEnabled: false,
      },
      askVwap: 0.5,
      traderDelta: 0,
      previousTraderSize: 0,
      balances: { cash: 10_000 },
      maxPositionSizePusd: 500,
    });
    expect(input.fixedShareCount).toBe(7);
  });
});
