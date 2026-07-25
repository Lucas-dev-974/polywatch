import { describe, expect, it } from 'vitest';
import {
  COLLATERAL_OFFRAMP_ADDRESS,
  PUSD_TOKEN_ADDRESS,
  USDC_E_ADDRESS,
} from '@polywatch/core';
import {
  buildUnwrapDepositWalletCalls,
  buildUnwrapTransactions,
  encodeErc20Approve,
  encodePusdUnwrap,
} from './collateral-ramp.js';

describe('collateral-ramp encoders', () => {
  const recipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const amountRaw = 1_500_000n;

  it('encodes ERC20 approve for offramp', () => {
    const data = encodeErc20Approve(COLLATERAL_OFFRAMP_ADDRESS, amountRaw);
    expect(data.startsWith('0x095ea7b3')).toBe(true);
  });

  it('encodes offramp unwrap to USDC.e', () => {
    const data = encodePusdUnwrap(recipient, amountRaw);
    expect(data.startsWith('0x')).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it('builds approve + unwrap transaction batch', () => {
    const txs = buildUnwrapTransactions(recipient, amountRaw);
    expect(txs).toHaveLength(2);
    expect(txs[0].to).toBe(PUSD_TOKEN_ADDRESS);
    expect(txs[0].data).toBe(
      encodeErc20Approve(COLLATERAL_OFFRAMP_ADDRESS, amountRaw),
    );
    expect(txs[1].to).toBe(COLLATERAL_OFFRAMP_ADDRESS);
    expect(txs[1].data).toBe(encodePusdUnwrap(recipient, amountRaw));
    expect(txs[1].value).toBe('0');
  });

  it('builds deposit wallet calls from unwrap batch', () => {
    const calls = buildUnwrapDepositWalletCalls(recipient, amountRaw);
    expect(calls).toHaveLength(2);
    expect(calls[0].target).toBe(PUSD_TOKEN_ADDRESS);
    expect(calls[1].target).toBe(COLLATERAL_OFFRAMP_ADDRESS);
  });

  it('uses USDC.e as unwrap asset', () => {
    expect(USDC_E_ADDRESS.toLowerCase()).toBe(
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    );
  });
});
