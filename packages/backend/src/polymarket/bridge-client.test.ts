import { describe, expect, it } from 'vitest';
import { pickBridgeDepositAsset, normalizeDepositAddresses, type BridgeSupportedAsset } from './bridge-client.js';

const assets: BridgeSupportedAsset[] = [
  {
    chainId: '1',
    chainName: 'Ethereum',
    token: { name: 'Ether', symbol: 'ETH', address: '0xEeee', decimals: 18 },
    minCheckoutUsd: 7,
  },
  {
    chainId: '137',
    chainName: 'Polygon',
    token: { name: 'POL', symbol: 'POL', address: '0xEeee', decimals: 18 },
    minCheckoutUsd: 2,
  },
  {
    chainId: '8253038',
    chainName: 'Bitcoin',
    token: {
      name: 'Bitcoin',
      symbol: 'BTC',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 8,
    },
    minCheckoutUsd: 9,
  },
  {
    chainId: '8253038',
    chainName: 'Bitcoin',
    token: {
      name: 'Bitcoin',
      symbol: 'BTC',
      address: 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8',
      decimals: 8,
    },
    minCheckoutUsd: 9,
  },
];

describe('pickBridgeDepositAsset', () => {
  it('prefers Ethereum for ETH', () => {
    const picked = pickBridgeDepositAsset(assets, 'ETH');
    expect(picked.chainName).toBe('Ethereum');
  });

  it('prefers Polygon for POL', () => {
    const picked = pickBridgeDepositAsset(assets, 'POL');
    expect(picked.chainName).toBe('Polygon');
  });

  it('prefers native BTC address over EVM placeholder', () => {
    const picked = pickBridgeDepositAsset(assets, 'BTC');
    expect(picked.token.address.startsWith('bc1')).toBe(true);
  });

  it('throws for unsupported symbol', () => {
    expect(() => pickBridgeDepositAsset(assets, 'SOL')).toThrow('bridge_asset_unsupported:SOL');
  });
});

describe('normalizeDepositAddresses', () => {
  it('unwraps nested address object from bridge API', () => {
    expect(
      normalizeDepositAddresses({
        address: {
          evm: '0xabc',
          svm: 'sol123',
          btc: 'bc1qtest',
          tron: 'TRON123',
        },
      }),
    ).toEqual({
      evm: '0xabc',
      svm: 'sol123',
      btc: 'bc1qtest',
      tvm: 'TRON123',
    });
  });
});
