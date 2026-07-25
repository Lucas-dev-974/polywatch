import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Market,
  createTestDataSource,
  initializeDataSource,
} from '@polywatch/core';
import {
  UNRESOLVED_WINNING_TOKEN_STALE_MS,
  countStaleUnresolvedWinningTokenMarkets,
} from './market-resolution-monitoring.js';

describe('countStaleUnresolvedWinningTokenMarkets', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('counts markets with winningTokenId set, unresolved, and stale updatedAt', async () => {
    const repo = ds.getRepository(Market);
    const staleAt = new Date(Date.now() - UNRESOLVED_WINNING_TOKEN_STALE_MS - 60_000);

    await repo.save(
      repo.create({
        conditionId: 'cond-stale-spread',
        winningTokenId: 'token-yes',
        resolved: false,
        closed: false,
        acceptingOrders: true,
        updatedAt: staleAt,
      }),
    );

    await repo.save(
      repo.create({
        conditionId: 'cond-fresh-spread',
        winningTokenId: 'token-yes',
        resolved: false,
        closed: false,
        acceptingOrders: true,
        updatedAt: new Date(),
      }),
    );

    await repo.save(
      repo.create({
        conditionId: 'cond-resolved',
        winningTokenId: 'token-yes',
        resolved: true,
        closed: true,
        acceptingOrders: false,
        updatedAt: staleAt,
      }),
    );

    const count = await countStaleUnresolvedWinningTokenMarkets(ds);
    expect(count).toBe(1);
  });

  it('returns 0 when no stale unresolved winning-token markets exist', async () => {
    const count = await countStaleUnresolvedWinningTokenMarkets(ds);
    expect(count).toBe(0);
  });
});
