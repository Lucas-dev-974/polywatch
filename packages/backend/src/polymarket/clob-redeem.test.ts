import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  encodeCtfRedeemCalldata,
  encodeNegRiskRedeemCalldata,
  negRiskRedeemAmounts,
  partitionIndexSet,
  normalizeConditionIdBytes,
  redeemOnChain,
  type RedeemOnChainInput,
} from './clob-redeem.js';
import { POLYGON_CLOB_CONTRACTS_V2, USDC_E_ADDRESS } from '@polywatch/core';

const CONDITION_ID =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets)',
];

const NEG_RISK_ABI = [
  'function redeemPositions(bytes32 conditionId, uint256[] calldata amounts)',
];

describe('partitionIndexSet', () => {
  it('returns [1] for YES and [2] for NO', () => {
    expect(partitionIndexSet('YES')).toEqual([1n]);
    expect(partitionIndexSet('NO')).toEqual([2n]);
  });
});

describe('negRiskRedeemAmounts', () => {
  it('places quantity on YES or NO slot', () => {
    const qty = 50_000_000n;
    expect(negRiskRedeemAmounts('YES', qty)).toEqual([qty, 0n]);
    expect(negRiskRedeemAmounts('NO', qty)).toEqual([0n, qty]);
  });
});

describe('normalizeConditionIdBytes', () => {
  it('normalizes a hex condition ID', () => {
    const hex = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(normalizeConditionIdBytes(`0x${hex}`)).toBe(`0x${hex}`);
  });

  it('throws on invalid hex', () => {
    expect(() => normalizeConditionIdBytes('0xshort')).toThrow('invalid_condition_id');
  });
});

describe('encodeCtfRedeemCalldata', () => {
  it('encodes YES redemption with explicit USDC.e collateral', () => {
    const calldata = encodeCtfRedeemCalldata({
      conditionId: CONDITION_ID,
      winningOutcome: 'YES',
      collateralAddress: USDC_E_ADDRESS,
      indexSet: 1,
    });
    const iface = new ethers.Interface(CTF_ABI);
    const decoded = iface.decodeFunctionData('redeemPositions', calldata);
    expect(decoded[0]).toBe(USDC_E_ADDRESS);
    expect(decoded[1]).toBe(ethers.ZeroHash);
    expect(decoded[2]).toBe(CONDITION_ID);
    expect(decoded[3]).toEqual([1n]);
  });

  it('encodes NO redemption with pUSD collateral and indexSet 2', () => {
    const calldata = encodeCtfRedeemCalldata({
      conditionId: CONDITION_ID,
      winningOutcome: 'NO',
      collateralAddress: POLYGON_CLOB_CONTRACTS_V2.collateral,
    });
    const iface = new ethers.Interface(CTF_ABI);
    const decoded = iface.decodeFunctionData('redeemPositions', calldata);
    expect(decoded[0]).toBe(POLYGON_CLOB_CONTRACTS_V2.collateral);
    expect(decoded[3]).toEqual([2n]);
  });
});

describe('encodeNegRiskRedeemCalldata', () => {
  it('encodes YES winning amounts', () => {
    const qty = 100_000_000n;
    const calldata = encodeNegRiskRedeemCalldata({
      conditionId: CONDITION_ID,
      winningOutcome: 'YES',
      quantityRaw: qty,
    });
    const iface = new ethers.Interface(NEG_RISK_ABI);
    const decoded = iface.decodeFunctionData('redeemPositions', calldata);
    expect(decoded[0]).toBe(CONDITION_ID);
    expect(decoded[1]).toEqual([qty, 0n]);
  });

  it('encodes NO winning amounts', () => {
    const qty = 75_000_000n;
    const calldata = encodeNegRiskRedeemCalldata({
      conditionId: CONDITION_ID,
      winningOutcome: 'NO',
      quantityRaw: qty,
    });
    const iface = new ethers.Interface(NEG_RISK_ABI);
    const decoded = iface.decodeFunctionData('redeemPositions', calldata);
    expect(decoded[1]).toEqual([0n, qty]);
  });
});

describe('redeemOnChain', () => {
  const mockCreds = {
    walletAddress: '0x123',
    apiKeyEnc: null,
    secretEnc: null,
    passphraseEnc: null,
    signerPkEnc: null,
    signatureType: 3,
    funderAddress: null,
  };

  const baseInput: RedeemOnChainInput = {
    conditionId: CONDITION_ID,
    winningOutcome: 'YES',
    quantityRaw: '1000000',
    negRisk: false,
    mode: 'deposit',
    signerPkEnc: null,
    assetId: '8036505700604517620643464604893473733568199749683100933120857541137575242925',
  };

  it('rejects zero quantity', async () => {
    await expect(
      redeemOnChain(mockCreds, '0xabc', { ...baseInput, quantityRaw: '0' }),
    ).rejects.toThrow('invalid_redeem_quantity');
  });

  it('fails when assetId missing for CTF redeem', async () => {
    const result = await redeemOnChain(mockCreds, '0xabc', {
      ...baseInput,
      assetId: undefined,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('asset_id_required');
  });

  it('returns error result for deposit mode with empty creds', async () => {
    const result = await redeemOnChain(
      { ...mockCreds, walletAddress: '0xabc', funderAddress: '0xabc' },
      '0xabc',
      baseInput,
    );
    // Detection or signer/relayer fails — never throws
    expect(result.success).toBe(false);
    expect(result.txHash).toBe('');
  });

  it('requires signerPkEnc for safe mode (after collateral resolution path)', async () => {
    const result = await redeemOnChain(mockCreds, '0xabc', {
      ...baseInput,
      mode: 'safe',
      negRisk: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('signer_missing');
  });

  it('requires signerPkEnc for proxy mode on negRisk path', async () => {
    const result = await redeemOnChain(mockCreds, '0xabc', {
      ...baseInput,
      mode: 'proxy',
      negRisk: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('signer_missing');
  });
});
