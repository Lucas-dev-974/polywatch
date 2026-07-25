import type { DataSource } from 'typeorm';
import { getPrimaryWalletAccount } from './wallet-accounts.js';
import { tryFetchPusdBalance } from './pusd-balance.js';

/** Read-only wallet cash for real portfolio snapshots and period rotation. */
export async function fetchObservedWalletCash(
  ds: DataSource,
): Promise<number | null> {
  const account = await getPrimaryWalletAccount(ds);
  if (!account) return null;
  return tryFetchPusdBalance(account.depositAddress);
}
