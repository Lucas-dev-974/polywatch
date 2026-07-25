import { randomUUID } from 'node:crypto';
import { getAddress } from 'ethers';
import type { ClobCredentials, WalletAccount } from '@polywatch/core';
import { TransactionType } from '@polymarket/builder-relayer-client';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js';
import {
  requireAccountSignerAddress,
  resolveAccountWithdrawMode,
} from './wallet-account-context.js';
import { assertPusdBalanceOnDeposit } from './wallet-validation.js';
import { parsePusdAmountRaw, POLYGON_CHAIN_ID } from './polygon.js';
import type { WithdrawOutputAsset } from './pusd-transfer.js';
import {
  buildDepositWalletDeadline,
  buildDepositWalletTypedData,
  checksumDepositWalletCalls,
  DEPOSIT_WALLET_PREPARE_TTL_MS,
  verifyDepositWalletSignature,
  type DepositWalletTypedDataV4,
} from './deposit-wallet-signing.js';
import {
  buildRelayerDepositWalletCalls,
  fetchRelayerNonce,
  normalizeRelayerError,
  submitRelayerTransaction,
  waitForTxHash,
} from './relayer-client.js';

export type { DepositWalletTypedDataV4 as MetamaskTypedDataV4 };

export interface WithdrawPrepareResponse {
  prepareId: string;
  signMethod: 'typed_data_v4';
  signerAddress: string;
  typedData: DepositWalletTypedDataV4;
}

interface PreparedMetamaskWithdraw {
  creds: ClobCredentials;
  depositAddress: string;
  recipient: string;
  amount: number;
  outputAsset: WithdrawOutputAsset;
  signerAddress: string;
  nonce: string;
  deadline: string;
  calls: ReturnType<typeof checksumDepositWalletCalls>;
  factoryAddress: string;
  typedData: DepositWalletTypedDataV4;
  createdAt: number;
}

const preparedWithdrawals = new Map<string, PreparedMetamaskWithdraw>();

function cleanupPrepared(): void {
  const now = Date.now();
  for (const [id, entry] of preparedWithdrawals) {
    if (now - entry.createdAt > DEPOSIT_WALLET_PREPARE_TTL_MS) {
      preparedWithdrawals.delete(id);
    }
  }
}

export async function prepareMetamaskWithdraw(
  creds: ClobCredentials,
  account: WalletAccount,
  recipientAddress: string,
  amount: number,
  outputAsset: WithdrawOutputAsset,
): Promise<WithdrawPrepareResponse> {
  cleanupPrepared();

  const { depositAddress, effectiveWithdrawMode } = resolveAccountWithdrawMode(account);
  const signerAddress = requireAccountSignerAddress(account);
  if (effectiveWithdrawMode !== 'deposit') {
    throw new Error('metamask_withdraw_unsupported_mode');
  }
  const amountRaw = parsePusdAmountRaw(amount);
  await assertPusdBalanceOnDeposit(depositAddress, amountRaw);

  const calls = checksumDepositWalletCalls(
    buildRelayerDepositWalletCalls(outputAsset, recipientAddress, amountRaw),
  );
  const deadline = buildDepositWalletDeadline(true);
  const nonce = await fetchRelayerNonce(creds, getAddress(signerAddress), TransactionType.WALLET);
  const config = getContractConfig(POLYGON_CHAIN_ID);
  const factoryAddress = config.DepositWalletContracts.DepositWalletFactory;
  const typedData = buildDepositWalletTypedData(depositAddress, nonce, deadline, calls);

  const prepareId = randomUUID();
  preparedWithdrawals.set(prepareId, {
    creds,
    depositAddress: typedData.message.wallet,
    recipient: recipientAddress,
    amount,
    outputAsset,
    signerAddress: getAddress(signerAddress),
    nonce,
    deadline,
    calls,
    factoryAddress,
    createdAt: Date.now(),
    typedData,
  });

  return {
    prepareId,
    signMethod: 'typed_data_v4',
    signerAddress: getAddress(signerAddress),
    typedData,
  };
}

export async function submitMetamaskWithdraw(
  prepareId: string,
  signature: string,
  signerAddress: string,
): Promise<string> {
  cleanupPrepared();
  const prepared = preparedWithdrawals.get(prepareId);
  if (!prepared) throw new Error('withdraw_prepare_expired');

  if (prepared.signerAddress.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error('metamask_account_mismatch');
  }

  verifyDepositWalletSignature(prepared.typedData, signature, prepared.signerAddress);

  const request = {
    type: TransactionType.WALLET,
    from: prepared.signerAddress,
    to: prepared.factoryAddress,
    nonce: prepared.nonce,
    signature,
    depositWalletParams: {
      depositWallet: prepared.depositAddress,
      deadline: prepared.deadline,
      calls: prepared.calls,
    },
  };

  try {
    const response = await submitRelayerTransaction(prepared.creds, request);
    preparedWithdrawals.delete(prepareId);
    return waitForTxHash(response);
  } catch (err) {
    throw normalizeRelayerError(err);
  }
}

export function isDepositWalletMetamaskMode(account: WalletAccount): boolean {
  return resolveAccountWithdrawMode(account).effectiveWithdrawMode === 'deposit';
}
