import { describe, expect, it } from 'vitest';
import { deriveProxyWallet } from '@polymarket/builder-relayer-client/dist/builder/derive.js';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js';
import { ethers } from 'ethers';
import { POLYGON_CHAIN_ID } from './polygon.js';
import { encodePusdTransferCalldata, PUSD_TOKEN_ADDRESS } from './pusd-erc20.js';
import { buildUnwrapTransactions } from './collateral-ramp.js';
import {
  encodePusdTransferTx,
  resolveEffectiveWithdrawMode,
  resolveWithdrawMode,
  SIGNATURE_TYPE_DEPOSIT_WALLET,
  SIGNATURE_TYPE_EOA,
  SIGNATURE_TYPE_POLY_GNOSIS_SAFE,
  SIGNATURE_TYPE_POLY_PROXY,
} from './relayer-client.js';

describe('resolveWithdrawMode', () => {
  it('returns eoa only for signature type 0 without L2 deposit', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_EOA, false)).toBe('eoa');
  });

  it('returns proxy for signature type 1 even without separate funder', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_POLY_PROXY, false)).toBe('proxy');
  });

  it('returns proxy for signature type 1 on L2', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_POLY_PROXY, true)).toBe('proxy');
  });

  it('returns safe for signature type 2 on L2', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_POLY_GNOSIS_SAFE, true)).toBe('safe');
  });

  it('returns deposit for signature type 3 on L2', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_DEPOSIT_WALLET, true)).toBe('deposit');
  });

  it('returns deposit for signature type 3 even without separate funder', () => {
    expect(resolveWithdrawMode(SIGNATURE_TYPE_DEPOSIT_WALLET, false)).toBe('deposit');
  });

  it('infers proxy when L2 and signature type 0', () => {
    expect(resolveWithdrawMode(0, true)).toBe('proxy');
  });
});

describe('resolveEffectiveWithdrawMode', () => {
  const signer = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const cfg = getContractConfig(POLYGON_CHAIN_ID);
  const proxyDeposit = deriveProxyWallet(signer, cfg.ProxyContracts.ProxyFactory);
  const depositWallet = '0x1234567890123456789012345678901234567890';

  it('returns eoa for non-L2 wallets', () => {
    expect(resolveEffectiveWithdrawMode(signer, signer, SIGNATURE_TYPE_EOA, false)).toBe('eoa');
  });

  it('detects proxy wallet from signer even when signature type is wrong', () => {
    const mode = resolveEffectiveWithdrawMode(
      signer,
      proxyDeposit,
      SIGNATURE_TYPE_DEPOSIT_WALLET,
      true,
    );
    expect(mode).toBe('proxy');
  });

  it('falls back to deposit mode when depot is not proxy or safe', () => {
    expect(
      resolveEffectiveWithdrawMode(signer, depositWallet, SIGNATURE_TYPE_POLY_PROXY, true),
    ).toBe('deposit');
  });

  it('uses configured mode when signer is unknown', () => {
    expect(resolveEffectiveWithdrawMode(null, depositWallet, SIGNATURE_TYPE_POLY_PROXY, true)).toBe(
      'proxy',
    );
  });
});

describe('encodePusdTransferTx', () => {
  it('encodes ERC20 transfer calldata', () => {
    const recipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const amountRaw = 1_000_000n;
    const tx = encodePusdTransferTx(recipient, amountRaw);

    expect(tx.to).toBe(PUSD_TOKEN_ADDRESS);
    expect(tx.value).toBe('0');
    expect(tx.data).toBe(encodePusdTransferCalldata(recipient, amountRaw));
  });
});

describe('buildUnwrapTransactions', () => {
  it('produces two-step approve and unwrap batch', () => {
    const recipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const txs = buildUnwrapTransactions(recipient, 2_000_000n);
    expect(txs).toHaveLength(2);
    expect(txs[0].to).toBe(PUSD_TOKEN_ADDRESS);
    expect(txs[1].value).toBe('0');
  });
});
