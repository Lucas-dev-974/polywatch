import { describe, it, expect, vi } from 'vitest';
import type { CopiedPosition, Market } from '@polywatch/core';
import { evaluateIlliquidPosition } from './position-branches.js';
import { makeCryptoConfig, makeGlobalConfig } from './test-config-fixtures.js';

function makePos(overrides: Partial<CopiedPosition> = {}): CopiedPosition {
  return {
    id: 1,
    quantity: 100,
    entryPrice: 0.5,
    entryBidVwap: 0.5,
    executableBidVwap: 0.5,
    trailingBidPoints: null,
    trailingActivationBidPoints: null,
    peakClosurePnlPercent: null,
    peakBidVwap: null,
    mode: 'sim',
    status: 'open',
    conditionId: '0xcond',
    assetId: '0xasset',
    watchlistId: 1,
    outcome: 'YES',
    side: 'BUY',
    entryFees: 0,
    entryFeesRemaining: 0,
    entryQuantityRemaining: 100,
    realizedPnl: 0,
    unrealizedPnl: 0,
    increaseCount: 0,
    liquidityStatus: 'illiquid',
    moveEventId: null,
    closingAttemptSeq: 0,
    reason: 'ALGO_OPEN',
    ...overrides,
  } as CopiedPosition;
}

describe('evaluateIlliquidPosition', () => {
  it('invokes exit evaluation for open illiquid positions', async () => {
    const evaluateCloseLogic = vi.fn();
    const exitEvaluator = {
      shouldRunCloseEval: vi.fn().mockReturnValue(true),
      evaluateCloseLogic,
      emitCloseSignal: vi.fn(),
    };

    await evaluateIlliquidPosition({
      pos: makePos(),
      market: undefined,
      globalConfig: makeGlobalConfig(),
      algoConfig: makeCryptoConfig(),
      connectionManager: { isBookConnectionHealthy: () => true } as any,
      positionService: { updatePnlFields: vi.fn() } as any,
      pnlPublisher: {
        shouldEmitTick: () => false,
        markTickEmitted: vi.fn(),
      } as any,
      exitEvaluator: exitEvaluator as any,
      bookPrices: { executableBidVwap: 0, liquidityStatus: 'illiquid' },
      wsBestBid: 0.42,
      settled: false,
      now: Date.now(),
      markBid: 0.42,
    });

    expect(evaluateCloseLogic).toHaveBeenCalledTimes(1);
    // [10]=wsBestBid, [11]=marketInterval, [12]=lastTradePrice
    expect(evaluateCloseLogic.mock.calls[0][10]).toBe(0.42);
    expect(evaluateCloseLogic.mock.calls[0][12]).toBeUndefined();
    expect(evaluateCloseLogic.mock.calls[0][11]).toBeUndefined();
  });

  it('passes lastTradePrice through to exit evaluation', async () => {
    const evaluateCloseLogic = vi.fn();
    const exitEvaluator = {
      shouldRunCloseEval: vi.fn().mockReturnValue(true),
      evaluateCloseLogic,
      emitCloseSignal: vi.fn(),
    };

    await evaluateIlliquidPosition({
      pos: makePos(),
      market: undefined,
      globalConfig: makeGlobalConfig(),
      algoConfig: makeCryptoConfig(),
      connectionManager: { isBookConnectionHealthy: () => true } as any,
      positionService: { updatePnlFields: vi.fn() } as any,
      pnlPublisher: {
        shouldEmitTick: () => false,
        markTickEmitted: vi.fn(),
      } as any,
      exitEvaluator: exitEvaluator as any,
      bookPrices: { executableBidVwap: 0.42, liquidityStatus: 'illiquid' },
      wsBestBid: 0.43,
      settled: false,
      now: Date.now(),
      markBid: 0.42,
      lastTradePrice: 0.41,
    });

    expect(evaluateCloseLogic).toHaveBeenCalledTimes(1);
    expect(evaluateCloseLogic.mock.calls[0][12]).toBe(0.41);
  });

  it('uses last trade price as conservative mark when stale bid masks a stop-loss breach', async () => {
    const evaluateCloseLogic = vi.fn();
    const exitEvaluator = {
      shouldRunCloseEval: vi.fn().mockReturnValue(true),
      evaluateCloseLogic,
      emitCloseSignal: vi.fn(),
    };

    await evaluateIlliquidPosition({
      pos: makePos({
        entryPrice: 0.56,
        entryBidVwap: 0.56,
        executableBidVwap: 0,
      }),
      market: undefined,
      globalConfig: makeGlobalConfig(),
      algoConfig: makeCryptoConfig(),
      connectionManager: { isBookConnectionHealthy: () => true } as any,
      positionService: { updatePnlFields: vi.fn() } as any,
      pnlPublisher: {
        shouldEmitTick: () => false,
        markTickEmitted: vi.fn(),
      } as any,
      exitEvaluator: exitEvaluator as any,
      bookPrices: { executableBidVwap: 0, liquidityStatus: 'illiquid' },
      wsBestBid: 0.55, // bid still near entry
      settled: false,
      now: Date.now(),
      markBid: 0.55,
      lastTradePrice: 0.32, // actual market already crashed
      lastTradeTimestamp: new Date(), // fresh timestamp — lastTradePrice is valid
    });

    expect(evaluateCloseLogic).toHaveBeenCalledTimes(1);
    // Both trigger and closure must reflect the crashed market so the SL fires.
    // [4]=trigger, [5]=closure after globalConfig+algoConfig were inserted.
    expect(evaluateCloseLogic.mock.calls[0][4]).toBeLessThan(-40); // trigger
    expect(evaluateCloseLogic.mock.calls[0][5]).toBeLessThan(-40); // closure
  });

  it('invokes exit evaluation when settled but a CLOB bid still exists', async () => {
    const evaluateCloseLogic = vi.fn();
    const exitEvaluator = {
      shouldRunCloseEval: vi.fn().mockReturnValue(true),
      evaluateCloseLogic,
      emitCloseSignal: vi.fn(),
    };

    const market = {
      resolved: false,
      winningTokenId: null,
      closed: true,
      acceptingOrders: false,
      endDate: new Date(Date.now() - 60_000),
    } as Market;

    await evaluateIlliquidPosition({
      pos: makePos({ entryBidVwap: 0.55 }),
      market,
      globalConfig: makeGlobalConfig(),
      algoConfig: makeCryptoConfig(),
      connectionManager: { isBookConnectionHealthy: () => true } as any,
      positionService: { updatePnlFields: vi.fn() } as any,
      pnlPublisher: {
        publishPositionPnl: vi.fn().mockResolvedValue({
          tick: { copiedPositionId: 1 },
          trigger: -20,
          closure: -20,
          peakClosure: -20,
          unrealizedPnl: -1,
        }),
        shouldEmitTick: () => false,
        markTickEmitted: vi.fn(),
      } as any,
      exitEvaluator: exitEvaluator as any,
      bookPrices: { executableBidVwap: 0.42, liquidityStatus: 'illiquid' },
      wsBestBid: 0.42,
      settled: true,
      now: Date.now(),
      markBid: 0.42,
      lastTradePrice: 0.41,
    });

    expect(evaluateCloseLogic).toHaveBeenCalledTimes(1);
    expect(evaluateCloseLogic.mock.calls[0][4]).toBeLessThan(0);
  });
});
