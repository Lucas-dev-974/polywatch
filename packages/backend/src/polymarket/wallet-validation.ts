import { ethers } from 'ethers';
import { USDC_E_ADDRESS } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';
import { walletAddressFromPrivateKey } from '../crypto/private-key.js';
import { createPolygonProvider } from './polygon.js';
import { PUSD_BALANCE_ABI, PUSD_TOKEN_ADDRESS } from './pusd-erc20.js';
import { deriveRelayerExecutionWallet } from './relayer-wallet-derive.js';
import type { RelayerWithdrawMode } from './relayer-client.js';

const OWNER_ABI = ['function owner() view returns (address)'];

export async function assertSignerControlsDeposit(
  depositAddress: string,
  signerAddress: string,
): Promise<void> {
  if (depositAddress.toLowerCase() === signerAddress.toLowerCase()) return;

  try {
    const provider = createPolygonProvider();
    const contract = new ethers.Contract(depositAddress, OWNER_ABI, provider);
    const owner: string = await contract.owner();
    if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error('deposit_signer_mismatch');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'deposit_signer_mismatch') throw err;
    throw new Error('deposit_signer_mismatch');
  }
}

export async function assertPusdBalanceOnDeposit(
  depositAddress: string,
  amountRaw: bigint,
): Promise<void> {
  await assertTokenBalanceOnDeposit(PUSD_TOKEN_ADDRESS, depositAddress, amountRaw);
}

export async function assertUsdceBalanceOnDeposit(
  depositAddress: string,
  amountRaw: bigint,
): Promise<void> {
  await assertTokenBalanceOnDeposit(USDC_E_ADDRESS, depositAddress, amountRaw);
}

async function assertTokenBalanceOnDeposit(
  tokenAddress: string,
  depositAddress: string,
  amountRaw: bigint,
): Promise<void> {
  const provider = createPolygonProvider();
  const token = new ethers.Contract(tokenAddress, PUSD_BALANCE_ABI, provider);
  const balance: bigint = await token.balanceOf(depositAddress);
  if (balance < amountRaw) {
    throw new Error(
      tokenAddress.toLowerCase() === USDC_E_ADDRESS.toLowerCase()
        ? 'insufficient_usdce_balance'
        : 'insufficient_balance',
    );
  }
}

export async function assertRelayerWithdrawReady(
  signerPkEnc: string | null,
  depositAddress: string,
  mode: RelayerWithdrawMode,
  amountRaw: bigint,
): Promise<void> {
  if (mode === 'deposit') {
    await assertPusdBalanceOnDeposit(depositAddress, amountRaw);
    return;
  }

  if (!signerPkEnc) throw new Error('signer_missing');
  const signerAddress = walletAddressFromPrivateKey(decrypt(signerPkEnc));
  const executionWallet = deriveRelayerExecutionWallet(
    signerAddress,
    mode as Exclude<RelayerWithdrawMode, 'deposit'>,
  );

  if (executionWallet.toLowerCase() !== depositAddress.toLowerCase()) {
    throw new Error('deposit_relayer_wallet_mismatch');
  }

  await assertPusdBalanceOnDeposit(executionWallet, amountRaw);
}

export async function assertRelayerWrapReady(
  signerPkEnc: string | null,
  depositAddress: string,
  mode: RelayerWithdrawMode,
  amountRaw: bigint,
): Promise<void> {
  if (mode === 'deposit') {
    await assertUsdceBalanceOnDeposit(depositAddress, amountRaw);
    return;
  }

  if (!signerPkEnc) throw new Error('signer_missing');
  const signerAddress = walletAddressFromPrivateKey(decrypt(signerPkEnc));
  const executionWallet = deriveRelayerExecutionWallet(
    signerAddress,
    mode as Exclude<RelayerWithdrawMode, 'deposit'>,
  );

  if (executionWallet.toLowerCase() !== depositAddress.toLowerCase()) {
    throw new Error('deposit_relayer_wallet_mismatch');
  }

  await assertUsdceBalanceOnDeposit(executionWallet, amountRaw);
}
