import { getAddress, verifyTypedData } from 'ethers';
import type { DepositWalletCall } from '@polymarket/builder-relayer-client';
import {
  DEPOSIT_WALLET_DOMAIN_NAME,
  DEPOSIT_WALLET_DOMAIN_VERSION,
} from '@polymarket/builder-relayer-client/dist/constants/index.js';
import { POLYGON_CHAIN_ID } from './polygon.js';

/** Polymarket relayer rejects deadlines shorter than ~600s from submission time. */
export const DEPOSIT_WALLET_DEADLINE_SECONDS = 600;

/** Extra buffer for MetaMask prepare → sign → submit flow. */
export const DEPOSIT_WALLET_METAMASK_DEADLINE_SECONDS = 1_800;

export const DEPOSIT_WALLET_PREPARE_TTL_MS =
  (DEPOSIT_WALLET_METAMASK_DEADLINE_SECONDS + 300) * 1_000;

export function buildDepositWalletDeadline(metamaskFlow = false): string {
  const offset = metamaskFlow
    ? DEPOSIT_WALLET_METAMASK_DEADLINE_SECONDS
    : DEPOSIT_WALLET_DEADLINE_SECONDS;
  return Math.floor(Date.now() / 1000 + offset).toString();
}

const DEPOSIT_WALLET_EIP712_TYPES = {
  Call: [
    { name: 'target', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  Batch: [
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'calls', type: 'Call[]' },
  ],
};

export interface DepositWalletTypedDataV4 {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: 'Batch';
  message: {
    wallet: string;
    nonce: string;
    deadline: string;
    calls: { target: string; value: string; data: string }[];
  };
}

export function checksumDepositWalletCalls(calls: DepositWalletCall[]): DepositWalletCall[] {
  return calls.map((call) => ({
    target: getAddress(call.target),
    value: String(call.value ?? '0'),
    data: call.data,
  }));
}

export function depositWalletBatchMessage(typedData: DepositWalletTypedDataV4) {
  return {
    wallet: typedData.message.wallet,
    nonce: BigInt(typedData.message.nonce),
    deadline: BigInt(typedData.message.deadline),
    calls: typedData.message.calls.map((call) => ({
      target: call.target,
      value: BigInt(call.value),
      data: call.data,
    })),
  };
}

export function buildDepositWalletTypedData(
  depositAddress: string,
  nonce: string,
  deadline: string,
  calls: DepositWalletCall[],
): DepositWalletTypedDataV4 {
  const wallet = getAddress(depositAddress);
  const normalizedCalls = checksumDepositWalletCalls(calls);

  return {
    domain: {
      name: DEPOSIT_WALLET_DOMAIN_NAME,
      version: DEPOSIT_WALLET_DOMAIN_VERSION,
      chainId: POLYGON_CHAIN_ID,
      verifyingContract: wallet,
    },
    types: DEPOSIT_WALLET_EIP712_TYPES,
    primaryType: 'Batch',
    message: {
      wallet,
      nonce,
      deadline,
      calls: normalizedCalls.map((call) => ({
        target: call.target,
        value: call.value,
        data: call.data,
      })),
    },
  };
}

export function verifyDepositWalletSignature(
  typedData: DepositWalletTypedDataV4,
  signature: string,
  signerAddress: string,
): void {
  const recovered = verifyTypedData(
    typedData.domain,
    typedData.types,
    depositWalletBatchMessage(typedData),
    signature,
  );

  if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error('deposit_signer_mismatch');
  }
}
