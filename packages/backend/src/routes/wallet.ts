import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  ClobCredentials,
  CopiedPosition,
  marketLifecycleFromEntity,
  MarketService,
  parsePusdAmountApi,
  sumOpenPositionsValue,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import {
  buildWalletOverview,
  getPrimaryWalletAccount,
  getWalletAccountById,
} from '../polymarket/wallet-accounts.js';
import {
  createDepositAddresses,
  fetchBridgeStatus,
  fetchSupportedAssets,
} from '../polymarket/bridge-client.js';
import { quoteBridgeDepositForPusd } from '../polymarket/bridge-quote.js';
import {
  tryFetchPusdBalance,
  tryFetchUsdcEBalance,
} from '../polymarket/pusd-balance.js';
import {
  withdrawFromWalletAccount,
  wrapFromWalletAccount,
  type WithdrawOutputAsset,
} from '../polymarket/pusd-transfer.js';
import {
  bridgeHttpErrorBody,
  mapBridgeQuoteRouteError,
} from '../polymarket/wallet-bridge-errors.js';
import {
  requireDepositWalletContext,
  requireWalletCredentials,
} from '../polymarket/wallet-route-context.js';
import {
  prepareMetamaskWithdraw,
  prepareMetamaskWrap,
  submitMetamaskWithdraw,
} from '../polymarket/relayer-metamask-withdraw.js';
import { sendWithdrawErrorResponse } from '../polymarket/withdraw-errors.js';
import { ethAddressSchema } from '../validation/eth-address.js';
import { registerWalletAccountRoutes } from './wallet-accounts.js';

function routeParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return decodeURIComponent(raw ?? '').trim();
}

const withdrawSchema = z.object({
  amount: z.union([
    z.string().regex(/^\d+(\.\d{1,6})?$/),
    z.number().positive(),
  ]),
  // Funds sent to a malformed recipient are unrecoverable.
  recipient: ethAddressSchema.optional(),
  outputAsset: z.enum(['usdc_e', 'pusd']).optional(),
  walletAccountId: z.number().int().positive().optional(),
});

const submitWithdrawSchema = z.object({
  prepareId: z.string().uuid(),
  signature: z.string().min(1),
  signerAddress: ethAddressSchema,
});

const wrapSchema = z.object({
  amount: z.union([
    z.string().regex(/^\d+(\.\d{1,6})?$/),
    z.number().positive(),
  ]),
  recipient: ethAddressSchema.optional(),
  walletAccountId: z.number().int().positive().optional(),
  signerAddress: ethAddressSchema.optional(),
});

export function createWalletRouter(ds: DataSource): Router {
  const router = Router();
  const credsRepo = () => ds.getRepository(ClobCredentials);

  registerWalletAccountRoutes(router, ds);

  router.get('/', requireJwt, async (_req, res) => {
    const creds = await credsRepo().findOne({ where: {} });
    const openPositions = await ds.getRepository(CopiedPosition).find({
      where: [
        { mode: 'real', status: 'open' },
        { mode: 'real', status: 'closing' },
        { mode: 'real', status: 'pending_resolution' },
        { mode: 'real', status: 'failed' },
      ],
    });

    const conditionIds = [...new Set(openPositions.map((p) => p.conditionId))];
    const marketRows = await new MarketService(ds).loadByConditionIds(conditionIds);
    const lifecycleByCondition = new Map(
      [...marketRows.entries()].map(([id, market]) => [
        id,
        marketLifecycleFromEntity(market),
      ]),
    );
    const positionsValueUsdc = sumOpenPositionsValue(
      openPositions,
      lifecycleByCondition,
    );

    const overview = await buildWalletOverview(ds, creds, {
      openPositionsCount: openPositions.filter((p) => p.status === 'open').length,
      positionsValueUsdc,
    });

    res.json(overview);
  });

  async function resolveWithdrawRequest(
    parsed: z.infer<typeof withdrawSchema>,
    res: import('express').Response,
  ) {
    const creds = await requireWalletCredentials(credsRepo(), res);
    if (!creds) return null;

    const account = parsed.walletAccountId
      ? await getWalletAccountById(ds, parsed.walletAccountId)
      : await getPrimaryWalletAccount(ds);

    if (!account) {
      res.status(400).json({ error: 'wallet_account_missing' });
      return null;
    }

    let amount: number;
    try {
      amount = parsePusdAmountApi(parsed.amount);
    } catch {
      res.status(400).json({ error: 'invalid_body' });
      return null;
    }

    const defaultRecipient = account.funderAddress ?? account.depositAddress;
    const recipient = parsed.recipient ?? defaultRecipient;
    const outputAsset: WithdrawOutputAsset = parsed.outputAsset ?? 'usdc_e';

    return { creds, account, amount, recipient, outputAsset };
  }

  async function resolveWrapRequest(
    parsed: z.infer<typeof wrapSchema>,
    res: import('express').Response,
  ) {
    const creds = await requireWalletCredentials(credsRepo(), res);
    if (!creds) return null;

    const account = parsed.walletAccountId
      ? await getWalletAccountById(ds, parsed.walletAccountId)
      : await getPrimaryWalletAccount(ds);

    if (!account) {
      res.status(400).json({ error: 'wallet_account_missing' });
      return null;
    }

    let amount: number;
    try {
      amount = parsePusdAmountApi(parsed.amount);
    } catch {
      res.status(400).json({ error: 'invalid_body' });
      return null;
    }

    // Wrap credits pUSD back to the same deposit account by default.
    const recipient = parsed.recipient ?? account.depositAddress;

    return { creds, account, amount, recipient, signerAddress: parsed.signerAddress };
  }

  router.post('/pusd/withdraw', requireJwt, async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const ctx = await resolveWithdrawRequest(parsed.data, res);
    if (!ctx) return;

    try {
      const txHash = await withdrawFromWalletAccount(
        ctx.creds,
        ctx.account,
        ctx.recipient,
        ctx.amount,
        ctx.outputAsset,
      );

      // The withdrawal already succeeded — a balance-report RPC failure must
      // not turn the response into an error (tolerant variants return null).
      const [pUsdBalance, usdcEBalance] = await Promise.all([
        tryFetchPusdBalance(ctx.account.depositAddress),
        ctx.outputAsset === 'usdc_e'
          ? tryFetchUsdcEBalance(ctx.recipient)
          : Promise.resolve(null),
      ]);

      res.json({
        txHash,
        outputAsset: ctx.outputAsset,
        ...(pUsdBalance != null ? { pUsdBalance } : {}),
        ...(usdcEBalance != null ? { usdcEBalance } : {}),
      });
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;

      req.log?.error({ err }, 'pusd withdraw failed');
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.status(502).json({ error: 'withdraw_failed', message });
    }
  });

  router.post('/pusd/withdraw/prepare', requireJwt, async (req, res) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const ctx = await resolveWithdrawRequest(parsed.data, res);
    if (!ctx) return;

    try {
      const prepared = await prepareMetamaskWithdraw(
        ctx.creds,
        ctx.account,
        ctx.recipient,
        ctx.amount,
        ctx.outputAsset,
      );
      res.json(prepared);
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: 'withdraw_prepare_failed' });
    }
  });

  router.post('/pusd/withdraw/submit', requireJwt, async (req, res) => {
    const parsed = submitWithdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    try {
      const txHash = await submitMetamaskWithdraw(
        parsed.data.prepareId,
        parsed.data.signature,
        parsed.data.signerAddress,
      );
      res.json({ txHash });
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;
      res.status(502).json({ error: 'withdraw_submit_failed' });
    }
  });

  router.post('/usdce/wrap', requireJwt, async (req, res) => {
    const parsed = wrapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const ctx = await resolveWrapRequest(parsed.data, res);
    if (!ctx) return;

    try {
      const txHash = await wrapFromWalletAccount(
        ctx.creds,
        ctx.account,
        ctx.recipient,
        ctx.amount,
      );

      // The wrap already succeeded — a balance-report RPC failure must not
      // turn the response into an error (tolerant variants return null).
      const [pUsdBalance, usdcEBalance] = await Promise.all([
        tryFetchPusdBalance(ctx.account.depositAddress),
        tryFetchUsdcEBalance(ctx.account.depositAddress),
      ]);

      res.json({
        txHash,
        ...(pUsdBalance != null ? { pUsdBalance } : {}),
        ...(usdcEBalance != null ? { usdcEBalance } : {}),
      });
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;

      req.log?.error({ err }, 'usdce wrap failed');
      const message = err instanceof Error ? err.message : 'unknown_error';
      res.status(502).json({ error: 'wrap_failed', message });
    }
  });

  router.post('/usdce/wrap/prepare', requireJwt, async (req, res) => {
    const parsed = wrapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const ctx = await resolveWrapRequest(parsed.data, res);
    if (!ctx) return;

    try {
      const prepared = await prepareMetamaskWrap(
        ctx.creds,
        ctx.account,
        ctx.recipient,
        ctx.amount,
        ctx.signerAddress,
      );
      res.json(prepared);
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: 'wrap_prepare_failed' });
    }
  });

  router.post('/usdce/wrap/submit', requireJwt, async (req, res) => {
    const parsed = submitWithdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    try {
      const txHash = await submitMetamaskWithdraw(
        parsed.data.prepareId,
        parsed.data.signature,
        parsed.data.signerAddress,
      );
      res.json({ txHash });
    } catch (err) {
      if (sendWithdrawErrorResponse(res, err)) return;
      res.status(502).json({ error: 'wrap_submit_failed' });
    }
  });

  router.get('/bridge/supported-assets', requireJwt, async (_req, res) => {
    try {
      res.json(await fetchSupportedAssets());
    } catch (err) {
      res.status(502).json(bridgeHttpErrorBody(err));
    }
  });

  router.post('/bridge/deposit-addresses', requireJwt, async (_req, res) => {
    const creds = await credsRepo().findOne({ where: {} });
    const depositCtx = await requireDepositWalletContext(creds, res);
    if (!depositCtx) return;

    try {
      res.json(await createDepositAddresses(depositCtx.depositAddress));
    } catch (err) {
      res.status(502).json(bridgeHttpErrorBody(err));
    }
  });

  const bridgeQuoteSchema = z.object({
    pusdAmount: z.number().positive(),
    assetSymbol: z.enum(['BTC', 'ETH', 'POL', 'SOL']),
  });

  router.post('/bridge/deposit-quote', requireJwt, async (req, res) => {
    const parsed = bridgeQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const creds = await credsRepo().findOne({ where: {} });
    const depositCtx = await requireDepositWalletContext(creds, res);
    if (!depositCtx) return;

    try {
      const bridgeAddresses = await createDepositAddresses(depositCtx.depositAddress);
      res.json(
        await quoteBridgeDepositForPusd(
          depositCtx.depositAddress,
          bridgeAddresses,
          parsed.data.assetSymbol,
          parsed.data.pusdAmount,
        ),
      );
    } catch (err) {
      const mapped = mapBridgeQuoteRouteError(err);
      if (mapped) {
        res.status(mapped.status).json(mapped.body);
        return;
      }
      res.status(502).json(bridgeHttpErrorBody(err));
    }
  });

  router.get('/bridge/status/:address', requireJwt, async (req, res) => {
    const address = routeParam(req.params.address);
    if (!address) {
      res.status(400).json({ error: 'invalid_address' });
      return;
    }

    try {
      res.json(await fetchBridgeStatus(address));
    } catch (err) {
      res.status(502).json(bridgeHttpErrorBody(err));
    }
  });

  return router;
}
