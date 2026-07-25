import { describe, expect, it } from 'vitest';
import type { Position } from './position';
import {
  isPositionUpDownMarket,
  positionChartQuantity,
  positionToMarketChartContext,
} from './position-market-chart';

function basePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 1,
    conditionId: '0xabc123',
    assetId: 'asset-1',
    outcome: 'Up',
    quantity: 10,
    entryPrice: 0.5,
    status: 'open',
    mode: 'sim',
    unrealizedPnl: 0,
    realizedPnl: 0,
    liquidityStatus: 'ok',
    closedAt: null,
    closeReason: null,
    openedAt: null,
    traderName: null,
    traderAddress: null,
    marketQuestion: null,
    marketUrl: null,
    marketIcon: null,
    marketEndDate: null,
    marketTagSlugs: [],
    marketCategory: null,
    marketResolved: false,
    marketClosed: false,
    marketAcceptingOrders: true,
    marketWinningTokenId: null,
    entryFees: 0,
    ...overrides,
  };
}

describe('isPositionUpDownMarket', () => {
  it('returns true for Up/Down crypto question', () => {
    expect(
      isPositionUpDownMarket(
        basePosition({
          marketQuestion: 'Bitcoin Up or Down - June 23, 4:50AM-4:55AM ET',
        }),
      ),
    ).toBe(true);
  });

  it('returns false for non-crypto market', () => {
    expect(
      isPositionUpDownMarket(
        basePosition({ marketQuestion: 'Will Trump win the 2024 election?' }),
      ),
    ).toBe(false);
  });

  it('returns false when marketQuestion is null', () => {
    expect(isPositionUpDownMarket(basePosition({ marketQuestion: null }))).toBe(
      false,
    );
  });
});

describe('positionToMarketChartContext', () => {
  it('maps Up/Down BTC question to chart context with crypto symbol', () => {
    const ctx = positionToMarketChartContext(
      basePosition({
        marketQuestion: 'Bitcoin Up or Down - June 23, 4:50AM-4:55AM ET',
        marketEndDate: '2024-06-23T08:55:00.000Z',
      }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.conditionId).toBe('0xabc123');
    expect(ctx!.cryptoSymbol).toBeTruthy();
    expect(ctx!.interval).toBe('5m');
    expect(ctx!.assetId).toBe('asset-1');
    expect(ctx!.positionQuantity).toBe(10);
    expect(ctx!.marketEndAt).toBe('2024-06-23T08:55:00.000Z');
    expect(ctx!.chartPositions).toHaveLength(1);
    expect(ctx!.chartPositions![0]!.id).toBe(1);
    expect(ctx!.chartPositions![0]!.assetId).toBe('asset-1');
  });

  it('returns non-null for non-crypto market (generic chart context)', () => {
    const ctx = positionToMarketChartContext(
      basePosition({ marketQuestion: 'Will Biden run again?' }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.conditionId).toBe('0xabc123');
    expect(ctx!.cryptoSymbol).toBeNull();
    expect(ctx!.interval).toBeNull();
  });

  it('returns symbol with null interval when window is missing', () => {
    const ctx = positionToMarketChartContext(
      basePosition({ marketQuestion: 'Bitcoin Up or Down on June 23?' }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.cryptoSymbol).toBeTruthy();
    expect(ctx!.interval).toBeNull();
  });

  it('returns non-null context even when marketQuestion is null (generic chart)', () => {
    const ctx = positionToMarketChartContext(basePosition());
    expect(ctx).not.toBeNull();
    expect(ctx!.conditionId).toBe('0xabc123');
    expect(ctx!.cryptoSymbol).toBeNull();
  });

  it('returns null when conditionId is empty', () => {
    expect(
      positionToMarketChartContext(basePosition({ conditionId: '' })),
    ).toBeNull();
  });
});

describe('positionChartQuantity', () => {
  it('uses open quantity when position is open', () => {
    expect(positionChartQuantity(basePosition({ quantity: 7 }))).toBe(7);
  });

  it('uses entryQuantityFilled when closed with zero quantity', () => {
    expect(
      positionChartQuantity(
        basePosition({ status: 'closed', quantity: 0, entryQuantityFilled: 3.33 }),
      ),
    ).toBe(3.33);
  });
});