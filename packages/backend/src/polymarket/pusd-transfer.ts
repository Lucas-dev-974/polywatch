import { ethers } from 'ethers';
import type { ClobCredentials, WalletAccount } from '@polywatch/core';
import { COLLATERAL_OFFRAMP_ADDRESS, USDC_E_ADDRESS } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';
import { walletAddressFromPrivateKey } from '../crypto/private-key.js';
import { createDepositSigner } from './eoa-signer.js';
import { parsePusdAmountRaw } from './polygon.js';
import {
  PUSD_BALANCE_ABI,
  PUSD_TOKEN_ADDRESS,
  PUSD_TRANSFER_ABI,
} from './pusd-erc20.js';
import { mapRampExecutionError } from './ramp-errors.js';
import { withdrawViaRelayer } from './relayer-client.js';
import { resolveAccountWithdrawMode } from './wallet-account-context.js';
import { mergeWithdrawCredentials } from './wallet-accounts.js';
import { assertSignerControlsDeposit } from './wallet-validation.js';

export type WithdrawOutputAsset = 'usdc_e' | 'pusd';

const TX_TIMEOUT_MS = 120_000;

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
];

const OFFRAMP_ABI = [
  'function unwrap(address _asset, address _to, uint256 _amount) external',
];

async function assertPusdBalance(
  token: ethers.Contract,
  depositAddress: string,
  amountRaw: bigint,
): Promise<void> {
  const balance: bigint = await token.balanceOf(depositAddress);
  if (balance < amountRaw) throw new Error('insufficient_balance');
}

async function withdrawPusdFromEoa(
  creds: ClobCredentials,
  depositAddress: string,
  recipientAddress: string,
  amount: number,
): Promise<string> {
  try {
    const signer = createDepositSigner(creds, depositAddress);
    const amountRaw = parsePusdAmountRaw(amount);
    const token = new ethers.Contract(
      PUSD_TOKEN_ADDRESS,
      [...PUSD_BALANCE_ABI, ...PUSD_TRANSFER_ABI],
      signer,
    );

    await assertPusdBalance(token, depositAddress, amountRaw);
    const tx = await token.transfer(recipientAddress, amountRaw);
    const receipt = await tx.wait(1, TX_TIMEOUT_MS);
    if (!receipt || receipt.status === 0) throw new Error('transfer_reverted');
    return tx.hash;
  } catch (err) {
    mapRampExecutionError(err);
  }
}

async function withdrawUsdceFromEoa(
  creds: ClobCredentials,
  depositAddress: string,
  recipientAddress: string,
  amount: number,
): Promise<string> {
  try {
    const signer = createDepositSigner(creds, depositAddress);
    const amountRaw = parsePusdAmountRaw(amount);
    const pusd = new ethers.Contract(
      PUSD_TOKEN_ADDRESS,
      [...PUSD_BALANCE_ABI, ...ERC20_APPROVE_ABI],
      signer,
    );
    const offramp = new ethers.Contract(
      COLLATERAL_OFFRAMP_ADDRESS,
      OFFRAMP_ABI,
      signer,
    );

    await assertPusdBalance(pusd, depositAddress, amountRaw);

    const approveTx = await pusd.approve(COLLATERAL_OFFRAMP_ADDRESS, amountRaw);
    const approveReceipt = await approveTx.wait(1, TX_TIMEOUT_MS);
    if (!approveReceipt || approveReceipt.status === 0) throw new Error('approve_reverted');

    const unwrapTx = await offramp.unwrap(USDC_E_ADDRESS, recipientAddress, amountRaw);
    const unwrapReceipt = await unwrapTx.wait(1, TX_TIMEOUT_MS);
    if (!unwrapReceipt || unwrapReceipt.status === 0) throw new Error('offramp_reverted');
    return unwrapTx.hash;
  } catch (err) {
    mapRampExecutionError(err);
  }
}

export async function withdrawFromWalletAccount(
  globalCreds: ClobCredentials,
  account: WalletAccount,
  recipientAddress: string,
  amount: number,
  outputAsset: WithdrawOutputAsset = 'usdc_e',
): Promise<string> {
  if (!account.signerPkEnc) throw new Error('signer_missing');

  const creds = mergeWithdrawCredentials(globalCreds, account);
  const { depositAddress, isL2Deposit, signerAddress, effectiveWithdrawMode: mode } =
    resolveAccountWithdrawMode(
      account,
      walletAddressFromPrivateKey(decrypt(account.signerPkEnc)),
    );

  if (isL2Deposit && mode !== 'eoa' && signerAddress) {
    await assertSignerControlsDeposit(depositAddress, signerAddress);
  }

  if (outputAsset === 'pusd') {
    if (mode === 'eoa') {
      return withdrawPusdFromEoa(creds, depositAddress, recipientAddress, amount);
    }
    return withdrawViaRelayer(
      creds,
      depositAddress,
      recipientAddress,
      amount,
      mode,
      'pusd',
    );
  }

  if (mode === 'eoa') {
    return withdrawUsdceFromEoa(creds, depositAddress, recipientAddress, amount);
  }
  return withdrawViaRelayer(
    creds,
    depositAddress,
    recipientAddress,
    amount,
    mode,
    'usdc_e',
  );
}
