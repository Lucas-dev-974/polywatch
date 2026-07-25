import type { DataSource, Repository } from 'typeorm';
import {
  ClobCredentials,
  WalletAccount as WalletAccountEntity,
  type WalletAccount,
} from '@polywatch/core';
import { encrypt } from '../crypto/encryption.js';
import { validatePrivateKey } from '../crypto/private-key.js';
import { hasBuilderCredentials } from './clob-creds.js';
import { resolveDepositForCredentials } from './deposit-wallet.js';
import { tryFetchPusdBalance } from './pusd-balance.js';
import {
  resolveAccountWithdrawMode,
  type EffectiveWithdrawMode,
} from './wallet-account-context.js';

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

export interface WalletOverviewResponse {
  accounts: WalletAccountView[];
  totalPUsdBalance: number;
  openPositionsCount: number;
  positionsValueUsdc: number;
  depositAddress: string | null;
  eoaAddress: string | null;
  isL2Deposit: boolean;
  signatureType: number | null;
  hasBuilderCreds: boolean;
  pUsdBalance: number;
}

export interface UpsertWalletAccountInput {
  label: string;
  depositAddress: string;
  funderAddress?: string | null;
  signerPrivateKey?: string;
  signatureType: number;
  isPrimary?: boolean;
}

function accountsRepo(ds: DataSource): Repository<WalletAccount> {
  return ds.getRepository(WalletAccountEntity);
}

export async function bootstrapWalletAccounts(ds: DataSource): Promise<void> {
  const repo = accountsRepo(ds);
  if ((await repo.count()) > 0) return;

  const creds = await ds.getRepository(ClobCredentials).findOne({ where: {} });
  if (!creds) return;

  const depositAddress = await resolveDepositForCredentials(
    creds.walletAddress,
    creds.funderAddress,
  );
  if (!depositAddress) return;

  await repo.save(
    repo.create({
      label: 'Principal',
      depositAddress,
      funderAddress: creds.funderAddress,
      signerPkEnc: creds.signerPkEnc,
      signatureType: creds.signatureType ?? 3,
      isPrimary: true,
      sortOrder: 0,
    }),
  );
}

export async function listWalletAccounts(ds: DataSource): Promise<WalletAccount[]> {
  return accountsRepo(ds).find({
    order: { sortOrder: 'ASC', id: 'ASC' },
  });
}

export async function getWalletAccountById(
  ds: DataSource,
  id: number,
): Promise<WalletAccount | null> {
  return accountsRepo(ds).findOne({ where: { id } });
}

export async function getPrimaryWalletAccount(
  ds: DataSource,
): Promise<WalletAccount | null> {
  const repo = accountsRepo(ds);
  const primary = await repo.findOne({ where: { isPrimary: true } });
  if (primary) return primary;
  return repo.findOne({ order: { sortOrder: 'ASC', id: 'ASC' } });
}

async function clearPrimaryFlag(ds: DataSource, exceptId?: number): Promise<void> {
  const repo = accountsRepo(ds);
  const all = await repo.find();
  for (const row of all) {
    if (exceptId != null && row.id === exceptId) continue;
    if (row.isPrimary) {
      row.isPrimary = false;
      await repo.save(row);
    }
  }
}

export async function createWalletAccount(
  ds: DataSource,
  creds: ClobCredentials | null,
  input: UpsertWalletAccountInput,
): Promise<WalletAccount> {
  const repo = accountsRepo(ds);
  const count = await repo.count();
  const isPrimary = input.isPrimary ?? count === 0;

  if (isPrimary) await clearPrimaryFlag(ds);

  const row = repo.create({
    label: input.label.trim(),
    depositAddress: input.depositAddress.trim(),
    funderAddress: input.funderAddress?.trim() || null,
    signerPkEnc: input.signerPrivateKey
      ? encrypt(validatePrivateKey(input.signerPrivateKey))
      : null,
    signatureType: input.signatureType,
    isPrimary,
    sortOrder: count,
  });

  return repo.save(row);
}

export async function updateWalletAccount(
  ds: DataSource,
  id: number,
  input: Partial<UpsertWalletAccountInput>,
): Promise<WalletAccount | null> {
  const repo = accountsRepo(ds);
  const row = await repo.findOne({ where: { id } });
  if (!row) return null;

  if (input.label != null) row.label = input.label.trim();
  if (input.depositAddress != null) row.depositAddress = input.depositAddress.trim();
  if (input.funderAddress !== undefined) {
    row.funderAddress = input.funderAddress?.trim() || null;
  }
  if (input.signerPrivateKey?.trim()) {
    row.signerPkEnc = encrypt(validatePrivateKey(input.signerPrivateKey));
  }
  if (input.signatureType != null) row.signatureType = input.signatureType;

  if (input.isPrimary) {
    await clearPrimaryFlag(ds, id);
    row.isPrimary = true;
  }

  return repo.save(row);
}

export async function deleteWalletAccount(ds: DataSource, id: number): Promise<boolean> {
  const repo = accountsRepo(ds);
  const row = await repo.findOne({ where: { id } });
  if (!row) return false;

  const wasPrimary = row.isPrimary;
  await repo.remove(row);

  if (wasPrimary) {
    const next = await repo.findOne({ order: { sortOrder: 'ASC', id: 'ASC' } });
    if (next) {
      next.isPrimary = true;
      await repo.save(next);
    }
  }

  return true;
}

export async function buildWalletAccountView(
  account: WalletAccount,
  creds: ClobCredentials | null,
): Promise<WalletAccountView> {
  const withdrawCtx = resolveAccountWithdrawMode(account);
  // Display-only context: degrade to 0 (logged) instead of failing the
  // whole accounts list when the Polygon RPC hiccups.
  const pUsdBalance =
    (await tryFetchPusdBalance(withdrawCtx.depositAddress)) ?? 0;

  return {
    id: account.id,
    label: account.label,
    depositAddress: withdrawCtx.depositAddress,
    eoaAddress: withdrawCtx.isL2Deposit ? withdrawCtx.eoaAddress : null,
    isL2Deposit: withdrawCtx.isL2Deposit,
    signatureType: withdrawCtx.signatureType,
    effectiveWithdrawMode: withdrawCtx.effectiveWithdrawMode,
    isPrimary: account.isPrimary,
    pUsdBalance,
    hasSigner: !!account.signerPkEnc,
    hasBuilderCreds: hasBuilderCredentials(creds),
  };
}

export async function buildWalletOverview(
  ds: DataSource,
  creds: ClobCredentials | null,
  positionsMeta: { openPositionsCount: number; positionsValueUsdc: number },
): Promise<WalletOverviewResponse> {
  const accounts = await listWalletAccounts(ds);
  const views = await Promise.all(
    accounts.map((account) => buildWalletAccountView(account, creds)),
  );

  const totalPUsdBalance = views.reduce((sum, v) => sum + v.pUsdBalance, 0);
  const primary = views.find((v) => v.isPrimary) ?? views[0] ?? null;

  return {
    accounts: views,
    totalPUsdBalance,
    openPositionsCount: positionsMeta.openPositionsCount,
    positionsValueUsdc: positionsMeta.positionsValueUsdc,
    depositAddress: primary?.depositAddress ?? null,
    eoaAddress: primary?.eoaAddress ?? null,
    isL2Deposit: primary?.isL2Deposit ?? false,
    signatureType: primary?.signatureType ?? null,
    hasBuilderCreds: hasBuilderCredentials(creds),
    pUsdBalance: primary?.pUsdBalance ?? 0,
  };
}

export function mergeWithdrawCredentials(
  globalCreds: ClobCredentials,
  account: WalletAccount,
): ClobCredentials {
  return {
    ...globalCreds,
    walletAddress: account.depositAddress,
    funderAddress: account.funderAddress,
    signerPkEnc: account.signerPkEnc,
    signatureType: account.signatureType,
  };
}
