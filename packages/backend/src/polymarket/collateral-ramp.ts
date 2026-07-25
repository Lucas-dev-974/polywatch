import { ethers } from 'ethers';
import type { DepositWalletCall, Transaction } from '@polymarket/builder-relayer-client';
import {
  COLLATERAL_OFFRAMP_ADDRESS,
  COLLATERAL_ONRAMP_ADDRESS,
  PUSD_TOKEN_ADDRESS,
  USDC_E_ADDRESS,
} from '@polywatch/core';

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
];

const OFFRAMP_ABI = [
  'function unwrap(address _asset, address _to, uint256 _amount) external',
];

const ONRAMP_ABI = [
  'function wrap(address _asset, address _to, uint256 _amount) external',
];

const erc20Iface = new ethers.Interface(ERC20_APPROVE_ABI);
const offrampIface = new ethers.Interface(OFFRAMP_ABI);
const onrampIface = new ethers.Interface(ONRAMP_ABI);

export function encodeErc20Approve(spender: string, amountRaw: bigint): string {
  return erc20Iface.encodeFunctionData('approve', [spender, amountRaw]);
}

export function encodePusdUnwrap(recipient: string, amountRaw: bigint): string {
  return offrampIface.encodeFunctionData('unwrap', [
    USDC_E_ADDRESS,
    recipient,
    amountRaw,
  ]);
}

export function encodeUsdceWrap(recipient: string, amountRaw: bigint): string {
  return onrampIface.encodeFunctionData('wrap', [
    USDC_E_ADDRESS,
    recipient,
    amountRaw,
  ]);
}

export function buildUnwrapTransactions(
  recipient: string,
  amountRaw: bigint,
): Transaction[] {
  return [
    {
      to: PUSD_TOKEN_ADDRESS,
      data: encodeErc20Approve(COLLATERAL_OFFRAMP_ADDRESS, amountRaw),
      value: '0',
    },
    {
      to: COLLATERAL_OFFRAMP_ADDRESS,
      data: encodePusdUnwrap(recipient, amountRaw),
      value: '0',
    },
  ];
}

export function buildUnwrapDepositWalletCalls(
  recipient: string,
  amountRaw: bigint,
): DepositWalletCall[] {
  return buildUnwrapTransactions(recipient, amountRaw).map((tx) => ({
    target: tx.to,
    value: tx.value,
    data: tx.data,
  }));
}

/** USDC.e → pUSD via Polymarket collateral on-ramp (deposit wallet). */
export function buildWrapTransactions(
  recipient: string,
  amountRaw: bigint,
): Transaction[] {
  return [
    {
      to: USDC_E_ADDRESS,
      data: encodeErc20Approve(COLLATERAL_ONRAMP_ADDRESS, amountRaw),
      value: '0',
    },
    {
      to: COLLATERAL_ONRAMP_ADDRESS,
      data: encodeUsdceWrap(recipient, amountRaw),
      value: '0',
    },
  ];
}

export function buildWrapDepositWalletCalls(
  recipient: string,
  amountRaw: bigint,
): DepositWalletCall[] {
  return buildWrapTransactions(recipient, amountRaw).map((tx) => ({
    target: tx.to,
    value: tx.value,
    data: tx.data,
  }));
}

export function transactionsToDepositWalletCalls(
  txs: Transaction[],
): DepositWalletCall[] {
  return txs.map((tx) => ({
    target: tx.to,
    value: tx.value,
    data: tx.data,
  }));
}
