import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import { USDC_E_ADDRESS } from '@polywatch/core';
import { parseRedemptionPayoutFromLogs } from './collateral-detection.js';

describe('parseRedemptionPayoutFromLogs', () => {
  const payoutIface = new ethers.Interface([
    'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
  ]);

  it('reads PayoutRedemption.payout > 0', () => {
    const data = payoutIface.encodeEventLog('PayoutRedemption', [
      '0xB6ce54F3290dae58C4334Ae6B326C0AA801645FB',
      USDC_E_ADDRESS,
      ethers.ZeroHash,
      '0x6340f14ab158d28071625c7e4f3cb5f1a2cbbd0b71af38fbaa60b89ce9e00790',
      [1n],
      5_060_235n,
    ]);
    const parsed = parseRedemptionPayoutFromLogs([
      { topics: data.topics as string[], data: data.data },
    ]);
    expect(parsed.source).toBe('PayoutRedemption');
    expect(parsed.payoutRaw).toBe(5_060_235n);
  });

  it('reads PayoutRedemption.payout = 0 without inventing quantity', () => {
    const data = payoutIface.encodeEventLog('PayoutRedemption', [
      '0xB6ce54F3290dae58C4334Ae6B326C0AA801645FB',
      USDC_E_ADDRESS,
      ethers.ZeroHash,
      '0x6340f14ab158d28071625c7e4f3cb5f1a2cbbd0b71af38fbaa60b89ce9e00790',
      [1n],
      0n,
    ]);
    const parsed = parseRedemptionPayoutFromLogs([
      { topics: data.topics as string[], data: data.data },
    ]);
    expect(parsed.source).toBe('PayoutRedemption');
    expect(parsed.payoutRaw).toBe(0n);
  });

  it('returns null when no redemption events', () => {
    const parsed = parseRedemptionPayoutFromLogs([
      { topics: [ethers.id('Transfer(address,address,uint256)')], data: '0x' },
    ]);
    expect(parsed.payoutRaw).toBeNull();
    expect(parsed.source).toBeNull();
  });
});
