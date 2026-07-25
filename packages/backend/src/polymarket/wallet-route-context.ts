import type { Response } from 'express';
import type { Repository } from 'typeorm';
import type { ClobCredentials } from '@polywatch/core';
import {
  resolveWalletContext,
  type ResolvedWalletContext,
} from './wallet-context.js';

export async function requireWalletCredentials(
  credsRepo: Repository<ClobCredentials>,
  res: Response,
): Promise<ClobCredentials | null> {
  const creds = await credsRepo.findOne({ where: {} });
  if (!creds) {
    res.status(400).json({ error: 'credentials_missing' });
    return null;
  }
  return creds;
}

export async function requireDepositWalletContext(
  creds: ClobCredentials | null | undefined,
  res: Response,
): Promise<{ ctx: ResolvedWalletContext; depositAddress: string } | null> {
  const ctx = await resolveWalletContext(creds);
  if (!ctx.depositAddress) {
    res.status(400).json({ error: 'deposit_missing' });
    return null;
  }
  return { ctx, depositAddress: ctx.depositAddress };
}
