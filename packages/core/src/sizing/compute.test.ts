import { describe, expect, it } from 'vitest';
import { coerceLegacySizingMode, computeSellQuantity, computeTargetQuantity } from './compute.js';

describe('computeTargetQuantity', () => {
  it('applies fixed_ratio sizing', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_ratio',
      copyRatio: 0.5,
      fixedPusdAmount: null,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.6,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBeCloseTo(100, 2);
  });

  it('applies fixed_pusd sizing', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_pusd',
      copyRatio: 1,
      fixedPusdAmount: 60,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.6,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBeCloseTo(100, 2);
  });

  it('treats leftover fixed_usdc as fixed_pusd (pre-migration rows)', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_usdc' as 'fixed_pusd',
      copyRatio: 1,
      fixedPusdAmount: 60,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.6,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBeCloseTo(100, 2);
  });

  it('applies proportional_capital sizing from equity vs trader value', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'proportional_capital',
      copyRatio: 1,
      fixedPusdAmount: null,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 5_000,
      userCapital: 10_000,
      traderBalance: 20_000,
      maxPositionSizePusd: 10_000,
    });
    expect(qty).toBeCloseTo(100, 2);
  });

  it('caps proportional_capital by available cash', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'proportional_capital',
      copyRatio: 1,
      fixedPusdAmount: null,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 30,
      userCapital: 10_000,
      traderBalance: 20_000,
      maxPositionSizePusd: 10_000,
    });
    expect(qty).toBeCloseTo(60, 2);
  });

  it('rejects quantities below the minimum order size', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_pusd',
      copyRatio: 1,
      fixedPusdAmount: 0.5,
      traderDeltaSize: 1,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.6,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBeNull();
  });

  it('applies fixed_shares sizing with exact share count', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_shares',
      copyRatio: 1,
      fixedPusdAmount: null,
      fixedShareCount: 5,
      traderDeltaSize: 200,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.42,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBe(5);
  });

  it('caps fixed_shares by available cash and max position', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_shares',
      copyRatio: 1,
      fixedPusdAmount: null,
      fixedShareCount: 5,
      traderDeltaSize: 0,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 1.2,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBe(2);
  });

  it('applies signal multiplier to fixed_shares with floor', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_shares',
      copyRatio: 1,
      fixedPusdAmount: null,
      fixedShareCount: 5,
      signalMultiplier: 0.4,
      traderDeltaSize: 0,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBe(2);
  });

  it('returns null when fixed_shares floors to zero shares', () => {
    const qty = computeTargetQuantity({
      sizingMode: 'fixed_shares',
      copyRatio: 1,
      fixedPusdAmount: null,
      fixedShareCount: 4,
      signalMultiplier: 0.2,
      traderDeltaSize: 0,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    });
    expect(qty).toBeNull();
  });

  it('keeps fixed_shares quantity stable across VWAP changes', () => {
    const base = {
      sizingMode: 'fixed_shares' as const,
      copyRatio: 1,
      fixedPusdAmount: null,
      fixedShareCount: 5,
      traderDeltaSize: 0,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      userBalance: 10_000,
      maxPositionSizePusd: 200,
    };
    expect(computeTargetQuantity({ ...base, executableAskVwap: 0.3 })).toBe(5);
    expect(computeTargetQuantity({ ...base, executableAskVwap: 0.8 })).toBe(5);
  });

  it('applies risk_based using absolute stopDistance (not ask × points)', () => {
    // quantity = budget / stopDistance → spend = quantity × ask
    // stopDistance=0.05, ask=0.5, budget=10 → qty=200, spend=100 (capped by max/cash)
    const qty = computeTargetQuantity({
      sizingMode: 'risk_based',
      copyRatio: 1,
      fixedPusdAmount: null,
      riskBudgetPusd: 10,
      stopDistance: 0.05,
      traderDeltaSize: 0,
      traderSizeBeforeMove: 0,
      ourQuantity: 0,
      executableAskVwap: 0.5,
      userBalance: 10_000,
      maxPositionSizePusd: 10_000,
    });
    expect(qty).toBeCloseTo(200, 5);

    // Buggy ask×sl would use stopDistance=0.025 → qty=400; assert we are not that path.
    const buggyWouldBe = 10 / (0.5 * 0.05) / 0.5; // = 400
    expect(qty).not.toBeCloseTo(buggyWouldBe, 0);
  });
});

describe('coerceLegacySizingMode', () => {
  it('maps leftover fixed_usdc to fixed_pusd and leaves other values intact', () => {
    expect(coerceLegacySizingMode('fixed_usdc')).toBe('fixed_pusd');
    expect(coerceLegacySizingMode('fixed_pusd')).toBe('fixed_pusd');
    expect(coerceLegacySizingMode('fixed_ratio')).toBe('fixed_ratio');
    expect(coerceLegacySizingMode(undefined)).toBeUndefined();
  });
});

describe('computeSellQuantity', () => {
  it('closes 100% on CLOSED', () => {
    expect(computeSellQuantity('CLOSED', 50, 100, 200)).toBe(50);
  });

  it('prorates on DECREASED', () => {
    expect(computeSellQuantity('DECREASED', 100, 50, 200)).toBe(25);
  });
});
