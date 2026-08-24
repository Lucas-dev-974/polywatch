import { describe, expect, it } from 'vitest';
import {
  BACKTEST_PLATFORM_FEE,
  simulateWeatherEntryFill,
  simulateWeatherExitFill,
} from './fill-engine.js';
import { computeTakerFee } from '@polywatch/core';

describe('simulateWeatherEntryFill', () => {
  it('applies positive slippage to the entry price', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 100,
      slippageBps: 50,
    });
    expect(r.entryPrice).toBeCloseTo(0.5 * 1.005, 5);
    expect(r.qty).toBeCloseTo(100 / (0.5 * 1.005), 5);
  });

  it('keeps entry price unchanged at zero slippage', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 100,
      slippageBps: 0,
    });
    expect(r.entryPrice).toBeCloseTo(0.5, 5);
  });

  it('caps qty when maxPositionSizeUsdc is below entryUsdc', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 1000,
      maxPositionSizeUsdc: 100,
      slippageBps: 0,
    });
    expect(r.qty).toBeCloseTo(100 / 0.5, 5);
  });

  it('uses full entryUsdc when no cap is provided', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 1000,
      slippageBps: 0,
    });
    expect(r.qty).toBeCloseTo(1000 / 0.5, 5);
  });

  it('clamps entry price to 1.0 when slippage pushes past 1', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.999,
      entryUsdc: 100,
      slippageBps: 200,
    });
    expect(r.entryPrice).toBe(1);
  });

  it('charges no fee at a clamped price of 1.0 (Polymarket curve = 0)', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.999,
      entryUsdc: 100,
      slippageBps: 200,
    });
    expect(r.entryPrice).toBe(1);
    // fee curve = price*(1-price) = 0 → fees = 0.
    expect(r.fees).toBe(0);
  });

  it('computes fees from the platform taker curve with a custom exponent', () => {
    const price = 0.5;
    const qty = 100;
    const customParams = { feeRate: 0.03, feeExponent: 2 };
    const expected = computeTakerFee(qty, price, customParams);
    // Entry uses BACKTEST_PLATFORM_FEE by default (exponent 1). Verify the
    // helper itself honours a custom exponent independently of the fill.
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(computeTakerFee(qty, price, BACKTEST_PLATFORM_FEE));
  });

  it('fixed_shares buys exactly fixedShareCount tokens regardless of price', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.0005,
      entryUsdc: 10,
      slippageBps: 0,
      sizingMode: 'fixed_shares',
      fixedShareCount: 5,
    });
    expect(r.qty).toBe(5);
    expect(r.entryPrice).toBeCloseTo(0.0005, 6);
  });

  it('fixed_shares caps qty by budget when maxPositionSizeUsdc is tight', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 10,
      slippageBps: 0,
      sizingMode: 'fixed_shares',
      fixedShareCount: 100,
      maxPositionSizeUsdc: 1,
    });
    // budget = min(1, 10) = 1 → maxShares = 1/0.5 = 2 → qty = min(100, 2) = 2
    expect(r.qty).toBe(2);
  });

  it('fixed_shares with zero fixedShareCount yields zero qty', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 10,
      slippageBps: 0,
      sizingMode: 'fixed_shares',
      fixedShareCount: 0,
    });
    expect(r.qty).toBe(0);
  });

  it('defaults to fixed_usdc when sizingMode is absent', () => {
    const r = simulateWeatherEntryFill({
      conditionId: 'c1',
      yesPrice: 0.5,
      entryUsdc: 100,
      slippageBps: 0,
    });
    expect(r.qty).toBeCloseTo(100 / 0.5, 5);
  });
});

describe('simulateWeatherExitFill', () => {
  it('applies negative slippage to the exit price', () => {
    const r = simulateWeatherExitFill({ qty: 100, yesPrice: 0.5, slippageBps: 50 });
    expect(r.exitPrice).toBeCloseTo(0.5 * 0.995, 5);
  });

  it('keeps exitPrice unchanged at zero slippage', () => {
    const r = simulateWeatherExitFill({ qty: 100, yesPrice: 0.5, slippageBps: 0 });
    expect(r.exitPrice).toBeCloseTo(0.5, 5);
  });

  it('clamps exit price to 0.0 when slippage pushes below zero', () => {
    // slippageBps 20000 = 200% → 0.5 * (1 - 2.0) = -0.5 → clampé à 0.
    const r = simulateWeatherExitFill({ qty: 100, yesPrice: 0.5, slippageBps: 20_000 });
    expect(r.exitPrice).toBe(0);
  });

  it('charges no fee at an exit price of 0', () => {
    const r = simulateWeatherExitFill({ qty: 100, yesPrice: 0.5, slippageBps: 20_000 });
    expect(r.exitPrice).toBe(0);
    expect(r.fees).toBe(0);
  });
});
