import { api } from '../api';
import {
  formatPusdAmount,
  hasSufficientPusdBalance,
  parsePusdAmount,
} from '@polywatch/core/polymarket/pusd-amount';
import { hasMetaMask } from './ethereum';
import { wrapL2ViaMetaMask, withdrawL2ViaMetaMask } from './metamask-relayer-withdraw';
import { withdrawPusdViaMetaMask } from './pusd-transfer';
import {
  usesMetamaskDepositWithdraw,
  WITHDRAW_RECIPIENT_CUSTOM,
  withdrawRecipientOptions,
  type WalletAccountView,
  type WalletData,
  type WithdrawOutputAsset,
} from './wallet';

export interface WithdrawResponse {
  txHash: string;
  outputAsset: WithdrawOutputAsset;
  /** Absent when the post-withdraw balance RPC was unavailable. */
  pUsdBalance?: number;
  usdcEBalance?: number;
}

export interface WrapResponse {
  txHash: string;
  /** Absent when the post-wrap balance RPC was unavailable. */
  pUsdBalance?: number;
  usdcEBalance?: number;
}

export function resolveWithdrawRecipient(
  account: WalletAccountView,
  allAccounts: WalletAccountView[],
  recipientKey: string,
  customRecipient: string,
): string {
  if (recipientKey === WITHDRAW_RECIPIENT_CUSTOM) {
    const custom = customRecipient.trim();
    if (!custom) throw new Error('Adresse destinataire requise');
    return custom;
  }
  const selected = withdrawRecipientOptions(account, allAccounts).find(
    (opt) => opt.id === recipientKey,
  );
  if (!selected) throw new Error('Destinataire invalide');
  return selected.address;
}

export function validateTransferAmount(input: string): bigint {
  try {
    const parsed = parsePusdAmount(input);
    if (parsed <= 0n) throw new Error('Montant invalide');
    return parsed;
  } catch (err) {
    if (err instanceof Error && err.message === 'invalid_pusd_amount') {
      throw new Error('Montant invalide');
    }
    throw err;
  }
}

export function validateWithdrawAmount(input: string, available: number): bigint {
  const parsed = validateTransferAmount(input);
  if (!hasSufficientPusdBalance(available, parsed)) {
    throw new Error('Montant superieur au solde disponible');
  }
  return parsed;
}

async function submitServerWithdraw(
  account: WalletAccountView,
  parsed: bigint,
  recipient: string,
  outputAsset: WithdrawOutputAsset,
): Promise<string> {
  const result = await api<WithdrawResponse>('/wallet/pusd/withdraw', {
    method: 'POST',
    body: JSON.stringify({
      amount: formatPusdAmount(parsed),
      recipient,
      outputAsset,
      walletAccountId: account.id,
    }),
  });
  return result.txHash;
}

export async function submitWalletWithdraw(
  wallet: WalletData,
  account: WalletAccountView,
  amount: string,
  recipientKey: string,
  customRecipient: string,
  outputAsset: WithdrawOutputAsset,
): Promise<string> {
  const parsed = validateWithdrawAmount(amount, account.pUsdBalance);
  const recipient = resolveWithdrawRecipient(
    account,
    wallet.accounts,
    recipientKey,
    customRecipient,
  );

  if (!hasMetaMask()) {
    if (account.isL2Deposit) {
      throw new Error('MetaMask requis pour retirer depuis un wallet L2');
    }
    if (!account.hasSigner) {
      throw new Error('signer_missing');
    }
    return submitServerWithdraw(account, parsed, recipient, outputAsset);
  }

  if (usesMetamaskDepositWithdraw(account)) {
    return withdrawL2ViaMetaMask(account, parsed, recipient, outputAsset);
  }

  if (account.isL2Deposit) {
    if (!account.hasSigner) throw new Error('signer_missing');
    return submitServerWithdraw(account, parsed, recipient, outputAsset);
  }

  if (outputAsset === 'pusd') {
    return withdrawPusdViaMetaMask(account.depositAddress, recipient, parsed);
  }

  if (!account.hasSigner) {
    throw new Error(
      'Le unwrap USDC.e necessite une cle signer ou un wallet L2. Retirez en pUSD brut via MetaMask.',
    );
  }
  return submitServerWithdraw(account, parsed, recipient, outputAsset);
}

export function withdrawButtonLabel(
  outputAsset: WithdrawOutputAsset,
  account: WalletAccountView,
): string {
  if (usesMetamaskDepositWithdraw(account)) {
    return outputAsset === 'usdc_e'
      ? 'Signer et retirer en USDC.e'
      : 'Signer et retirer en pUSD';
  }
  return outputAsset === 'usdc_e' ? 'Retirer en USDC.e' : 'Retirer en pUSD';
}

export function receivedTokenLabel(
  mode: 'deposit' | 'withdraw',
  outputAsset: WithdrawOutputAsset,
): string {
  if (mode === 'deposit') return 'pUSD';
  return outputAsset === 'usdc_e' ? 'USDC.e' : 'pUSD';
}

export function validateWrapAmount(input: string, availableUsdce: number): bigint {
  const parsed = validateTransferAmount(input);
  if (!hasSufficientPusdBalance(availableUsdce, parsed)) {
    throw new Error('Montant superieur au solde USDC.e disponible');
  }
  return parsed;
}

async function submitServerWrap(
  account: WalletAccountView,
  parsed: bigint,
  recipient: string,
): Promise<string> {
  const result = await api<WrapResponse>('/wallet/usdce/wrap', {
    method: 'POST',
    body: JSON.stringify({
      amount: formatPusdAmount(parsed),
      recipient,
      walletAccountId: account.id,
    }),
  });
  return result.txHash;
}

export async function submitWalletWrap(
  account: WalletAccountView,
  amount: string,
): Promise<string> {
  const available = account.usdcEBalance ?? 0;
  const parsed = validateWrapAmount(amount, available);
  // Wrap always credits pUSD back to the same deposit address — never the MetaMask EOA.
  const recipient = account.depositAddress;

  // Stored signer can execute the deposit-wallet batch via the relayer.
  // Do not force a MetaMask account switch when the key is already on the server.
  if (account.hasSigner) {
    return submitServerWrap(account, parsed, recipient);
  }

  if (!hasMetaMask()) {
    if (account.isL2Deposit) {
      throw new Error('MetaMask requis pour convertir depuis un wallet L2');
    }
    throw new Error('signer_missing');
  }

  if (usesMetamaskDepositWithdraw(account)) {
    return wrapL2ViaMetaMask(account, parsed, recipient);
  }

  throw new Error(
    'Le wrap USDC.e necessite une cle signer ou un wallet L2. Configurez un signer ou un wallet L2.',
  );
}

export function wrapButtonLabel(account: WalletAccountView): string {
  if (account.hasSigner) return 'Convertir en pUSD';
  return usesMetamaskDepositWithdraw(account)
    ? 'Signer et convertir en pUSD'
    : 'Convertir en pUSD';
}
