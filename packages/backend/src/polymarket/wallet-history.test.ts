import { Market } from '@polywatch/core';
import { describe, expect, it } from 'vitest';
import {
  mapActivitiesToHistoryEntries,
  mapActivityToHistoryEntry,
} from './wallet-history.js';
import type { DataApiActivity } from './data-api-client.js';

const baseActivity: DataApiActivity = {
  proxyWallet: '0xabc',
  timestamp: 1731489409,
  conditionId: '0xcond',
  type: 'TRADE',
  size: 199.95,
  usdcSize: 193.1517,
  transactionHash: '0x20684481425ea4912021f84fc77ef244d23f0dd160913f5d55649f004286c6cc',
  price: 0.966,
  asset: '123',
  side: 'BUY',
  outcomeIndex: 1,
  title: 'Henry Cavill announced as next James Bond?',
  slug: 'henry-cavill-announced-as-next-james-bond',
  outcome: 'No',
};

describe('mapActivityToHistoryEntry', () => {
  it('maps a TRADE activity with side and outcome', () => {
    const entry = mapActivityToHistoryEntry(baseActivity);
    expect(entry.category).toBe('trade');
    expect(entry.side).toBe('BUY');
    expect(entry.title).toContain('Achat');
    expect(entry.title).toContain('Henry Cavill');
    expect(entry.title).toContain('No');
    expect(entry.amount).toBe(193.1517);
    expect(entry.price).toBe(0.966);
    expect(entry.timestamp).toBe(1731489409000);
    expect(entry.explorerUrl).toContain('polygonscan.com/tx/0x2068');
  });

  it('maps REDEEM without side', () => {
    const entry = mapActivityToHistoryEntry({
      ...baseActivity,
      type: 'REDEEM',
      side: '',
      outcome: '',
      price: 0,
    });
    expect(entry.category).toBe('redeem');
    expect(entry.side).toBeNull();
    expect(entry.title).toContain('Rachat');
    expect(entry.price).toBeNull();
  });

  it('resolves REDEEM price from market payoff when usdcSize > 0', () => {
    const redeemActivity: DataApiActivity = {
      ...baseActivity,
      type: 'REDEEM',
      side: '',
      outcome: '',
      price: 0,
      usdcSize: 5.06,
    };
    const market = {
      conditionId: redeemActivity.conditionId,
      winningTokenId: redeemActivity.asset,
    } as Market;
    const marketMap = new Map([[market.conditionId.toLowerCase(), market]]);

    const entry = mapActivityToHistoryEntry(redeemActivity, marketMap);
    expect(entry.category).toBe('redeem');
    expect(entry.price).toBe(1);
  });

  it('does not invent REDEEM price when usdcSize is 0', () => {
    const redeemActivity: DataApiActivity = {
      ...baseActivity,
      type: 'REDEEM',
      side: '',
      outcome: '',
      price: 0,
      usdcSize: 0,
    };
    const market = {
      conditionId: redeemActivity.conditionId,
      winningTokenId: redeemActivity.asset,
    } as Market;
    const marketMap = new Map([[market.conditionId.toLowerCase(), market]]);

    const entry = mapActivityToHistoryEntry(redeemActivity, marketMap);
    expect(entry.category).toBe('redeem');
    expect(entry.amount).toBe(0);
    expect(entry.price).toBeNull();
  });

  it('maps unknown types to other', () => {
    const entry = mapActivityToHistoryEntry({
      ...baseActivity,
      type: 'REWARD',
      side: '',
    });
    expect(entry.category).toBe('other');
    expect(entry.title).toContain('REWARD');
  });

  it('handles missing transaction hash', () => {
    const entry = mapActivityToHistoryEntry({
      ...baseActivity,
      transactionHash: '',
    });
    expect(entry.txHash).toBeNull();
    expect(entry.explorerUrl).toBeNull();
    expect(entry.id).toContain('no-tx');
  });
});

describe('mapActivitiesToHistoryEntries', () => {
  it('sorts entries by timestamp descending', () => {
    const entries = mapActivitiesToHistoryEntries([
      { ...baseActivity, timestamp: 100 },
      { ...baseActivity, timestamp: 300, conditionId: '0x2' },
      { ...baseActivity, timestamp: 200, conditionId: '0x3' },
    ]);
    expect(entries.map((e) => e.timestamp)).toEqual([300_000, 200_000, 100_000]);
  });
});
