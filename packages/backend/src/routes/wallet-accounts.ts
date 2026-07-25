import type { Router } from 'express';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { ClobCredentials } from '@polywatch/core';
import {
  emptyableEthAddressSchema,
  ethAddressSchema,
} from '../validation/eth-address.js';
import { requireJwt } from '../middleware/auth.js';
import {
  buildWalletAccountView,
  createWalletAccount,
  deleteWalletAccount,
  getWalletAccountById,
  listWalletAccounts,
  updateWalletAccount,
} from '../polymarket/wallet-accounts.js';
import { fetchWalletAccountHistory } from '../polymarket/wallet-history.js';

const upsertSchema = z.object({
  label: z.string().min(1).max(64),
  // An invalid deposit address would silently send funds into the void.
  depositAddress: ethAddressSchema,
  funderAddress: emptyableEthAddressSchema.nullable().optional(),
  signerPrivateKey: z.string().optional(),
  signatureType: z.number().int().min(0).max(3),
  isPrimary: z.boolean().optional(),
});

const patchSchema = upsertSchema.partial();

function parseAccountId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseHistoryPagination(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 500);
  const offset = Math.max(Number(query.offset ?? 0), 0);
  return { limit, offset };
}

export function registerWalletAccountRoutes(router: Router, ds: DataSource): void {
  const credsRepo = () => ds.getRepository(ClobCredentials);

  router.get('/accounts', requireJwt, async (_req, res) => {
    const creds = await credsRepo().findOne({ where: {} });
    const accounts = await listWalletAccounts(ds);
    const views = await Promise.all(
      accounts.map((account) => buildWalletAccountView(account, creds)),
    );
    res.json({ accounts: views });
  });

  router.post('/accounts', requireJwt, async (req, res) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    try {
      const creds = await credsRepo().findOne({ where: {} });
      const account = await createWalletAccount(ds, creds, parsed.data);
      res.status(201).json(await buildWalletAccountView(account, creds));
    } catch (err) {
      if (err instanceof Error && err.message === 'invalid_signer_private_key') {
        res.status(400).json({
          error: 'invalid_signer_private_key',
          message:
            'Cle privee invalide. Exportez la cle depuis MetaMask (64 caracteres hex, pas la seed phrase).',
        });
        return;
      }
      throw err;
    }
  });

  router.put('/accounts/:id', requireJwt, async (req, res) => {
    const id = parseAccountId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    try {
      const creds = await credsRepo().findOne({ where: {} });
      const account = await updateWalletAccount(ds, id, parsed.data);
      if (!account) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      res.json(await buildWalletAccountView(account, creds));
    } catch (err) {
      if (err instanceof Error && err.message === 'invalid_signer_private_key') {
        res.status(400).json({
          error: 'invalid_signer_private_key',
          message:
            'Cle privee invalide. Exportez la cle depuis MetaMask (64 caracteres hex, pas la seed phrase).',
        });
        return;
      }
      throw err;
    }
  });

  router.get('/accounts/:id/history', requireJwt, async (req, res) => {
    const id = parseAccountId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const account = await getWalletAccountById(ds, id);
    if (!account) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const { limit, offset } = parseHistoryPagination(req.query);

    try {
      const history = await fetchWalletAccountHistory(account.depositAddress, {
        limit,
        offset,
        ds,
      });
      res.json({
        ...history,
        walletAccountId: id,
        walletLabel: account.label,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'wallet_history_fetch_failed';
      res.status(502).json({ error: 'wallet_history_fetch_failed', message });
    }
  });

  router.delete('/accounts/:id', requireJwt, async (req, res) => {
    const id = parseAccountId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const ok = await deleteWalletAccount(ds, id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json({ ok: true });
  });
}
