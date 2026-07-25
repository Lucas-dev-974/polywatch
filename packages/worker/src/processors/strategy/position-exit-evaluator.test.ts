import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PositionExitEvaluator } from './position-exit-evaluator.js';
import type { CopiedPosition, Market, RiskConfig } from '@polywatch/core';
import {
  FORCED_EXIT_RETRY_COOLDOWN_MS,
  SL_CONFIRMATION_MIN_WINDOW_MS,
} from '../../constants.js';

function makePos(overrides: Partial<CopiedPosition> = {}): CopiedPosition {
  return {
    id: 1,
    quantity: 100,
    entryPrice: 0.5,
    entryBidVwap: 0.5,
    executableBidVwap: 0.5,
    slBidPoints: 0.10,
    tpBidPoints: 0.12,
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
    liquidityStatus: 'ok',
    moveEventId: 'move-1',
    closingAttemptSeq: 0,
    forcedExitFailedAttempts: 0,
    lastForcedExitAttemptAt: null,
    lastExitBlockReason: null,
    lastExitBlockCloseReason: null,
    firstExitBlockAt: null,
    lastExitBlockAt: null,
    exitEmitBlockedCount: 0,
    ...overrides,
  } as CopiedPosition;
}

function makeRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    simTrailingStopPercent: null,
    simTrailingActivationPercent: null,
    simSlEnabled: true,
    simTpEnabled: true,
    simTrailingEnabled: false,
    simPreCloseEnabled: false,
    simPreCloseSeconds: 0,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0,
    realTrailingStopPercent: null,
    realTrailingActivationPercent: null,
    realSlEnabled: true,
    realTpEnabled: true,
    realTrailingEnabled: false,
    realPreCloseEnabled: false,
    realPreCloseSeconds: 0,
    realPreCloseKeepEnabled: false,
    realPreCloseKeepBidThreshold: 0,
    simSlCloseMaxRetries: 5,
    slConfirmationTicks: 1,
    ...overrides,
  } as RiskConfig;
}

describe('PositionExitEvaluator', () => {
  describe('evaluateCloseLogic', () => {
    it('skips close signal when a BUY is in flight', async () => {
      const enqueue = vi.fn();
      const isInFlightBuy = vi.fn().mockResolvedValue(true);
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        isInFlightBuy,
      );

      const pos = makePos();
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0.4,
        'ok',
      );

      expect(isInFlightBuy).toHaveBeenCalledWith(1);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('emits close signal when no BUY is in flight and SL is triggered', async () => {
      const enqueue = vi.fn();
      const isInFlightBuy = vi.fn().mockResolvedValue(false);
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        isInFlightBuy,
      );

      const pos = makePos();
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0.4,
        'ok',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      const signal = enqueue.mock.calls[0][0];
      expect(signal.reason).toBe('SL');
    });

    it('does not emit SL without any resolvable bid', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({ executableBidVwap: 0 });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
        0,
      );

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('emits SL using WS best bid when executable VWAP is zero', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({ executableBidVwap: 0 });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
        0.4,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('SL');
      expect(enqueue.mock.calls[0][0].referenceVwap).toBe(0.4);
      expect(enqueue.mock.calls[0][0].lastTradePrice).toBeUndefined();
    });

    it('emits SL using fresh lastCloseableBid when book and WS are empty', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({
        executableBidVwap: 0,
        lastCloseableBidVwap: 0.38,
        lastCloseableBidAt: new Date(),
      });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('SL');
      expect(enqueue.mock.calls[0][0].referenceVwap).toBe(0.38);
    });

    it('prefers lastCloseable over sized residual bestBid for SL emit', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({
        executableBidVwap: 0,
        lastCloseableBidVwap: 0.38,
        lastCloseableBidAt: new Date(),
      });

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        makeRisk(),
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
        undefined,
        null,
        undefined,
        null,
        null,
        undefined,
        undefined,
        0.01,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].referenceVwap).toBe(0.38);
    });

    it('records no_close_bid when SL decided but no emit bid available', async () => {
      const enqueue = vi.fn();
      const record = vi.fn().mockResolvedValue(undefined);
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
        undefined,
        record,
      );

      await evaluator.evaluateCloseLogic(
        makePos({ executableBidVwap: 0 }),
        undefined,
        makeRisk(),
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
      );

      expect(enqueue).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledWith(1, 'no_close_bid', 'SL', 0);
    });

    it('emits SL using fresh lastTradePrice when book, WS, and lastCloseable are empty', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({ executableBidVwap: 0 });
      const risk = makeRisk();
      const lastTradeAt = new Date();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
        undefined,
        null,
        0.35,
        null,
        lastTradeAt,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('SL');
      expect(enqueue.mock.calls[0][0].referenceVwap).toBe(0.35);
      expect(enqueue.mock.calls[0][0].lastTradePrice).toBe(0.35);
    });

    it('does not emit SL when lastCloseable is stale and no other bid exists', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const staleAt = new Date(Date.now() - 120_000);
      const pos = makePos({
        executableBidVwap: 0,
        lastCloseableBidVwap: 0.38,
        lastCloseableBidAt: staleAt,
      });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
      );

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not emit SL when pos-qty book is above threshold despite low ref-qty trigger', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({ entryBidVwap: 0.39, slBidPoints: 0.2 });
      const risk = makeRisk();

      // trigger/closure from executable pos-qty VWAP (0.39) — above SL threshold 0.19
      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -1,
        -1,
        -1,
        -0.01,
        0.39,
        'ok',
        undefined,
        null,
        undefined,
        null,
        undefined,
        0.11,
      );

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('carries lastTradePrice through to the close signal', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos({ executableBidVwap: 0 });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0,
        'illiquid',
        0.4,
        null,
        0.32,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].lastTradePrice).toBe(0.32);
    });

    it('emits PRE_CLOSE_LOSS in SOFT window for mild loss above SL threshold', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const endDate = new Date(Date.now() + 100_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      const pos = makePos({
        reason: 'ALGO_OPEN',
        executableBidVwap: 0.85,
      });
      const risk = makeRisk({
        simPreCloseEnabled: true,
        simPreCloseSeconds: 120,
        simPreCloseKeepEnabled: true,
        simPreCloseKeepBidThreshold: 0.80,
      });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        -5,
        -5,
        -5,
        -0.12,
        0.84,
        'ok',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('PRE_CLOSE_LOSS');
    });

    it.skip('emits TIME_EXIT in HARD window for losing algo position near endDate', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const endDate = new Date(Date.now() + 10_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      const pos = makePos({
        reason: 'ALGO_OPEN',
        executableBidVwap: 0.85,
      });
      const risk = makeRisk({
        simPreCloseEnabled: true,
        simPreCloseSeconds: 120,
        simPreCloseKeepEnabled: true,
        simPreCloseKeepBidThreshold: 0.80,
      });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        -5,
        -5,
        -5,
        -0.12,
        0.84,
        'ok',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('TIME_EXIT');
    });

    it('replays position 12988-style illiquid pre-close evaluation', async () => {
      const enqueue = vi.fn();
      const evaluateCloseLogic = vi.fn(async (...args: unknown[]) => {
        const evalFn = new PositionExitEvaluator(
          { enqueue } as any,
          vi.fn().mockResolvedValue(false),
        );
        return evalFn.evaluateCloseLogic(...(args as Parameters<typeof evalFn.evaluateCloseLogic>));
      });

      const endDate = new Date(Date.now() + 100_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      const pos = makePos({
        id: 12988,
        reason: 'ALGO_OPEN',
        entryPrice: 0.86,
        entryBidVwap: 0.85,
        executableBidVwap: 0,
        quantity: 2.5,
        entryQuantityRemaining: 2.5,
      });
      const risk = makeRisk({
        simPreCloseEnabled: true,
        simPreCloseSeconds: 120,
        simPreCloseKeepEnabled: true,
        simPreCloseKeepBidThreshold: 0.80,
      });

      await evaluateCloseLogic(
        pos,
        market,
        risk,
        -2.12,
        -2.12,
        -2.12,
        -0.05,
        0,
        'illiquid',
        0.84,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('PRE_CLOSE_LOSS');
    });

    it('emits PRE_CLOSE_WIN for winning algo position below confidence bid', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const endDate = new Date(Date.now() + 100_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      const pos = makePos({
        reason: 'ALGO_OPEN',
        executableBidVwap: 0.8,
      });
      const risk = makeRisk({
        simPreCloseEnabled: true,
        simPreCloseSeconds: 120,
        cryptoAlgoPreCloseEnabled: true,
        cryptoAlgoPreCloseKeepEnabled: true,
        cryptoAlgoPreCloseKeepBidThreshold: 0.85,
        cryptoAlgoTimeExitEnabled: false,
      });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        8,
        8,
        8,
        0.4,
        0.8,
        'ok',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('PRE_CLOSE_WIN');
    });

    it('defers SL when quantity is below market minimum (strategy mos gate)', async () => {
      // Mos gate only applies to SELL positions (minSellQuantityViolation checks side !== 'SELL')
      const enqueue = vi.fn();
      const mosResolver = vi.fn().mockResolvedValue(10); // minShares = 10, qty = 2
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
        mosResolver,
      );

      const pos = makePos({ id: 2, side: 'SELL', quantity: 2 });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0.4,
        'ok',
      );

      expect(mosResolver).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, quantity: 2 }),
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('emits PRE_CLOSE_LOSS when quantity meets market minimum (mos gate passes)', async () => {
      // Mos gate passes when resolver returns false (qty ≥ minShares) — signal emitted
      const enqueue = vi.fn();
      // Resolver returns false → quantity is NOT below market minimum → gate passes
      const mosResolver = vi.fn().mockResolvedValue(false);
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
        mosResolver,
      );

      const endDate = new Date(Date.now() + 100_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      // PRE_CLOSE_LOSS scenario: in SOFT window, mild loss, ALGO position
      const pos = makePos({ side: 'SELL', quantity: 100, reason: 'ALGO_OPEN' });
      const risk = makeRisk({ simPreCloseEnabled: true, simPreCloseSeconds: 120 });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        -5,
        -5,
        -5,
        -0.12,
        0.84,
        'ok',
      );

      // mosResolver called (gate entered), returned false → signal emitted
      expect(mosResolver).toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('PRE_CLOSE_LOSS');
    });

    it('emits PRE_CLOSE_LOSS when quantity is below market minimum but mos resolver returns false (cache miss)', async () => {
      const enqueue = vi.fn();
      // Cache miss / no resolver → mos check short-circuits to false
      const mosResolver = vi.fn().mockResolvedValue(false);
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
        mosResolver,
      );

      const endDate = new Date(Date.now() + 100_000);
      const market = {
        endDate,
        resolved: false,
        closed: false,
        acceptingOrders: true,
        winningTokenId: null,
      } as Market;

      const pos = makePos({ id: 5, quantity: 2, reason: 'ALGO_OPEN' });
      const risk = makeRisk({ simPreCloseEnabled: true, simPreCloseSeconds: 120 });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        -5,
        -5,
        -5,
        -0.12,
        0.84,
        'ok',
      );

      // mosResolver returned false → mos gate does NOT block
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('PRE_CLOSE_LOSS');
    });

    it('skips mos check entirely when resolver is not provided (backward compat)', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
        // resolveMos omitted → undefined
      );

      const pos = makePos({ quantity: 2 });
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0.4,
        'ok',
      );

      // No resolver → signal emitted normally (mos check is no-op)
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('SL');
    });

    it('emits SL on partial liquidity when executable bid is positive', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const pos = makePos();
      const risk = makeRisk();

      await evaluator.evaluateCloseLogic(
        pos,
        undefined,
        risk,
        -25,
        -25,
        -25,
        -0.5,
        0.01,
        'partial',
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].referenceVwap).toBe(0.01);
    });

    it.skip('emits TIME_EXIT on terminal settled market when losing and bid exists', async () => {
      const enqueue = vi.fn();
      const evaluator = new PositionExitEvaluator(
        { enqueue } as any,
        vi.fn().mockResolvedValue(false),
      );

      const endDate = new Date(Date.now() - 60_000);
      const market = {
        endDate,
        resolved: false,
        closed: true,
        acceptingOrders: false,
        winningTokenId: null,
      } as Market;

      const pos = makePos({
        reason: 'ALGO_OPEN',
        executableBidVwap: 0.48,
        entryBidVwap: 0.55,
        entryPrice: 0.57,
      });
      const risk = makeRisk({
        simPreCloseEnabled: true,
        simPreCloseSeconds: 120,
        cryptoAlgoTimeExitEnabled: true,
      });

      await evaluator.evaluateCloseLogic(
        pos,
        market,
        risk,
        -12,
        -12,
        -12,
        -0.5,
        0.48,
        'illiquid',
        0.48,
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0].reason).toBe('TIME_EXIT');
    });

    describe('SL confirmation window', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('requires both tick count and minimum window before emitting SL', async () => {
        const enqueue = vi.fn();
        const evaluator = new PositionExitEvaluator(
          { enqueue } as any,
          vi.fn().mockResolvedValue(false),
        );
        const pos = makePos();
        const risk = makeRisk({ slConfirmationTicks: 2 });

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          -25,
          -25,
          -25,
          -0.5,
          0.4,
          'ok',
        );
        expect(enqueue).not.toHaveBeenCalled();

        vi.advanceTimersByTime(SL_CONFIRMATION_MIN_WINDOW_MS + 1);

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          -25,
          -25,
          -25,
          -0.5,
          0.4,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][0].reason).toBe('SL');
      });

      it('resets SL confirmation after signal emission', async () => {
        const enqueue = vi.fn();
        const evaluator = new PositionExitEvaluator(
          { enqueue } as any,
          vi.fn().mockResolvedValue(false),
        );
        const pos = makePos();
        const risk = makeRisk({ slConfirmationTicks: 2 });

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          -25,
          -25,
          -25,
          -0.5,
          0.4,
          'ok',
        );
        vi.advanceTimersByTime(SL_CONFIRMATION_MIN_WINDOW_MS + 1);
        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          -25,
          -25,
          -25,
          -0.5,
          0.4,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(1);

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          -25,
          -25,
          -25,
          -0.5,
          0.4,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(1);
      });
    });

    describe('forced exit retry guard', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('blocks emission when forced exit retries are exhausted', async () => {
        const enqueue = vi.fn();
        const evaluator = new PositionExitEvaluator(
          { enqueue } as any,
          vi.fn().mockResolvedValue(false),
        );
        const pos = makePos({
          forcedExitFailedAttempts: 5,
          lastForcedExitAttemptAt: new Date(Date.now() - 60_000),
        });
        const risk = makeRisk({ simSlCloseMaxRetries: 5 });

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          50,
          50,
          50,
          1,
          0.9,
          'ok',
        );

        expect(enqueue).not.toHaveBeenCalled();
      });

      it('respects cooldown between forced exit emissions', async () => {
        const enqueue = vi.fn();
        const evaluator = new PositionExitEvaluator(
          { enqueue } as any,
          vi.fn().mockResolvedValue(false),
        );
        const pos = makePos();
        const risk = makeRisk();

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          50,
          50,
          50,
          1,
          0.9,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(1);

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          50,
          50,
          50,
          1,
          0.9,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(FORCED_EXIT_RETRY_COOLDOWN_MS + 1);

        await evaluator.evaluateCloseLogic(
          pos,
          undefined,
          risk,
          50,
          50,
          50,
          1,
          0.9,
          'ok',
        );
        expect(enqueue).toHaveBeenCalledTimes(2);
      });
    });
  });
});
