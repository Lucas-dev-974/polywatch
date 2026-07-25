import { api } from '../api';

export interface WalletAccountView {
  id: number;
  label: string;
  depositAddress: string;
  eoaAddress: string | null;
  isL2Deposit: boolean;
  signatureType: number;
  isPrimary: boolean;
  pUsdBalance: number;
  hasSigner: boolean;
  hasBuilderCreds: boolean;
  effectiveWithdrawMode: EffectiveWithdrawMode;
}

export type EffectiveWithdrawMode = 'eoa' | 'proxy' | 'safe' | 'deposit';

export function usesMetamaskDepositWithdraw(account: WalletAccountView): boolean {
  return account.isL2Deposit && account.effectiveWithdrawMode === 'deposit';
}

export function primaryWalletAccount(
  accounts: WalletAccountView[],
): WalletAccountView | null {
  return accounts.find((a) => a.isPrimary) ?? accounts[0] ?? null;
}

export interface WalletData {
  accounts: WalletAccountView[];
  totalPUsdBalance: number;
  depositAddress: string | null;
  eoaAddress: string | null;
  isL2Deposit: boolean;
  signatureType: number | null;
  hasBuilderCreds: boolean;
  pUsdBalance: number;
  openPositionsCount: number;
  positionsValueUsdc: number;
}

export interface TradingWalletSnapshot {
  label: string;
  equity: number;
  cash: number;
  positions: number;
  token: string;
}

/** Métriques du wallet principal utilisé pour le trading réel. */
export function tradingWalletSnapshot(data: WalletData): TradingWalletSnapshot {
  const account = primaryWalletAccount(data.accounts);
  const cash = account?.pUsdBalance ?? data.pUsdBalance ?? 0;
  const positions = data.positionsValueUsdc;

  return {
    label: account?.label ?? 'Capital wallet',
    equity: cash + positions,
    cash,
    positions,
    token: 'pUSD',
  };
}

export async function fetchWallet(): Promise<WalletData> {
  return api<WalletData>('/wallet');
}

export interface WalletAccountInput {
  label: string;
  depositAddress: string;
  funderAddress?: string | null;
  signerPrivateKey?: string;
  signatureType: number;
  isPrimary?: boolean;
}

export interface WithdrawRecipientOption {
  id: string;
  label: string;
  address: string;
}

export const WITHDRAW_RECIPIENT_CUSTOM = 'custom';

export function withdrawRecipientOptions(
  account: WalletAccountView,
  allAccounts: WalletAccountView[],
): WithdrawRecipientOption[] {
  const options: WithdrawRecipientOption[] = [];
  const seen = new Set<string>();

  const add = (id: string, label: string, address: string | null | undefined) => {
    if (!address) return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ id, label, address });
  };

  add('eoa', 'EOA MetaMask (funder)', account.eoaAddress);
  add('deposit', 'Depot Polymarket (L2)', account.depositAddress);

  for (const other of allAccounts) {
    if (other.id === account.id) continue;
    add(`deposit-${other.id}`, `${other.label} (depot)`, other.depositAddress);
    add(`funder-${other.id}`, `${other.label} (MetaMask)`, other.eoaAddress);
  }

  return options;
}

export function defaultWithdrawRecipientKey(
  account: WalletAccountView,
  allAccounts: WalletAccountView[],
): string {
  const options = withdrawRecipientOptions(account, allAccounts);
  if (options.some((o) => o.id === 'eoa')) return 'eoa';
  return options[0]?.id ?? WITHDRAW_RECIPIENT_CUSTOM;
}

export type WithdrawOutputAsset = 'usdc_e' | 'pusd';

export const WITHDRAW_OUTPUT_OPTIONS: { value: WithdrawOutputAsset; label: string }[] = [
  { value: 'usdc_e', label: 'USDC.e (unwrap)' },
  { value: 'pusd', label: 'pUSD brut' },
];

export type DepositTab = 'metamask' | 'bridge';

export const SIGNATURE_TYPE_DEPOSIT_WALLET = 3;

export const SIGNATURE_TYPE_OPTIONS = [
  { value: 0, label: '0 — EOA (MetaMask direct)' },
  { value: 1, label: '1 — PolyProxy (polymarket.com)' },
  { value: 2, label: '2 — Gnosis Safe' },
  { value: SIGNATURE_TYPE_DEPOSIT_WALLET, label: '3 — Deposit wallet (API)' },
];
