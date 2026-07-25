import type { WalletAccount } from '@polywatch/core';
import { resolveEffectiveWithdrawMode, type RelayerWithdrawMode } from './relayer-client.js';

export interface ResolvedAccountContext {
  depositAddress: string;
  eoaAddress: string;
  isL2Deposit: boolean;
  signatureType: number;
}

export type EffectiveWithdrawMode = RelayerWithdrawMode | 'eoa';

export interface ResolvedWithdrawContext extends ResolvedAccountContext {
  signerAddress: string | null;
  effectiveWithdrawMode: EffectiveWithdrawMode;
}

export function resolveAccountContext(account: WalletAccount): ResolvedAccountContext {
  const depositAddress = account.depositAddress;
  const signatureType = account.signatureType ?? 0;
  const eoaAddress = account.funderAddress ?? depositAddress;
  const isL2Deposit =
    signatureType !== 0 ||
    eoaAddress.toLowerCase() !== depositAddress.toLowerCase();

  return {
    depositAddress,
    eoaAddress,
    isL2Deposit,
    signatureType,
  };
}

export function resolveAccountSignerAddress(
  account: WalletAccount,
  fromPrivateKey?: string | null,
): string | null {
  const ctx = resolveAccountContext(account);
  const explicit = account.funderAddress?.trim() || fromPrivateKey?.trim();
  if (explicit) return explicit;
  if (!ctx.isL2Deposit) return ctx.eoaAddress;
  return null;
}

export function requireAccountSignerAddress(account: WalletAccount): string {
  const ctx = resolveAccountContext(account);
  const signer = account.funderAddress?.trim() || ctx.eoaAddress;
  if (!signer || signer.toLowerCase() === ctx.depositAddress.toLowerCase()) {
    throw new Error('metamask_funder_required');
  }
  return signer;
}

export function resolveAccountWithdrawMode(
  account: WalletAccount,
  fromPrivateKey?: string | null,
): ResolvedWithdrawContext {
  const ctx = resolveAccountContext(account);
  const signerAddress = resolveAccountSignerAddress(account, fromPrivateKey);
  const effectiveWithdrawMode = resolveEffectiveWithdrawMode(
    signerAddress,
    ctx.depositAddress,
    ctx.signatureType,
    ctx.isL2Deposit,
  );

  return { ...ctx, signerAddress, effectiveWithdrawMode };
}
