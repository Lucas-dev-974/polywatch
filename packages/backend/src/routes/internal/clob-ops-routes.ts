import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { TraderSnapshot } from '@polywatch/core';
import {
  ensureClobApprovals,
  requiredApprovalFlags,
  resolveClobOrderKind,
  type ClobOrderSide,
} from '../../polymarket/clob-approvals.js';
import { redeemOnChain, type RedemptionWalletMode } from '../../polymarket/clob-redeem.js';
import { resolveEffectiveWithdrawMode } from '../../polymarket/relayer-client.js';
import {
  decryptClobCredentials,
  resolveTradingWalletContext,
} from '../../polymarket/trading-wallet-resolver.js';
import { recordRedemption, recordRedemptionPayoff } from '../../metrics.js';

export function createInternalClobOpsRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/trader-snapshots/:address', async (req, res) => {
    const snapshots = await ds.getRepository(TraderSnapshot).find({
      where: { traderAddress: req.params.address },
    });
    res.json(snapshots);
  });

  router.get('/clob-credentials', async (_req, res) => {
    const ctx = await resolveTradingWalletContext(ds);
    if (!ctx) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(decryptClobCredentials(ctx.creds, ctx.merged));
  });

  router.post('/clob-approvals/ensure', async (req, res) => {
    const ctx = await resolveTradingWalletContext(ds);
    if (!ctx) {
      res.status(404).json({ error: 'clob_credentials_not_found' });
      return;
    }
    if (!ctx.depositAddress) {
      res.status(400).json({ error: 'no_deposit_address' });
      return;
    }
    const body = req.body as { negRisk?: unknown; side?: unknown };
    if (typeof body?.negRisk !== 'boolean' || (body.side !== 'BUY' && body.side !== 'SELL')) {
      res.status(400).json({ error: 'missing_required_fields' });
      return;
    }
    const required = requiredApprovalFlags(
      resolveClobOrderKind({
        negRisk: body.negRisk,
        side: body.side as ClobOrderSide,
      }),
    );
    try {
      const result = await ensureClobApprovals(ctx.merged, ctx.depositAddress, required);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: 'approval_failed', detail: (err as Error).message });
    }
  });

  router.post('/redeem', async (req, res) => {
    const { conditionId, winningOutcome, quantityRaw, negRisk, assetId } =
      req.body as {
        conditionId: string;
        winningOutcome: 'YES' | 'NO';
        quantityRaw: string;
        negRisk?: boolean;
        assetId?: string;
      };
    const isNegRisk = negRisk ?? false;
    if (
      !conditionId ||
      !winningOutcome ||
      !quantityRaw ||
      (winningOutcome !== 'YES' && winningOutcome !== 'NO')
    ) {
      res.status(400).json({ error: 'missing_required_fields' });
      return;
    }
    if (!isNegRisk && !assetId?.trim()) {
      res.status(400).json({ error: 'asset_id_required' });
      return;
    }

    const ctx = await resolveTradingWalletContext(ds);
    if (!ctx) {
      res.status(404).json({ error: 'clob_credentials_not_found' });
      return;
    }
    if (!ctx.depositAddress) {
      res.status(400).json({ error: 'no_deposit_address' });
      return;
    }

    const signerAddress = ctx.merged.funderAddress || ctx.merged.walletAddress;
    const signatureType = ctx.merged.signatureType ?? 3;
    const effectiveMode = resolveEffectiveWithdrawMode(
      signerAddress,
      ctx.depositAddress,
      signatureType,
      true,
    );
    const mode = effectiveMode === 'eoa' ? 'deposit' : effectiveMode;

    try {
      const result = await redeemOnChain(ctx.merged, ctx.depositAddress, {
        conditionId,
        winningOutcome,
        quantityRaw,
        negRisk: isNegRisk,
        mode: mode as RedemptionWalletMode,
        signerPkEnc: ctx.merged.signerPkEnc ?? null,
        assetId: assetId?.trim() || undefined,
      });
      recordRedemption(result.success ? 'success' : 'failed', 'real');
      if (result.success) {
        recordRedemptionPayoff('win');
      }
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: 'redemption_failed', detail: (err as Error).message });
    }
  });

  return router;
}