#!/usr/bin/env npx tsx
/**
 * RACHAT ON-CHAIN — via redeemOnChain() du backend (même code que prod).
 *
 * Nécessite `npm run build -w @polywatch/backend` avant exécution.
 * Alternative sans build backend : `04-redeem-correct-collateral.ts`.
 *
 * SÉCURITÉ:
 *   - Par défaut: --dry-run (aucune transaction)
 *   - Exécution réelle: --confirm obligatoire
 *
 * Usage:
 *   npx tsx tools/recover-stranded-redemption/02-redeem.ts --position-id 22441 --dry-run
 *   npx tsx tools/recover-stranded-redemption/02-redeem.ts --position-id 22441 --confirm
 *
 * Prérequis .env:
 *   DATABASE_URL, POLYGON_RPC_URL, MASTER_ENCRYPTION_KEY
 *   + credentials CLOB / signer (comme le backend)
 */
import { parseArgs } from 'node:util';
import { loadMonorepoEnv } from '../../packages/core/src/config/env.js';
import { pusdRawToNumber } from '../../packages/core/src/polymarket/pusd-amount.js';
import {
  buildWalletCandidates,
  createRecoveryPool,
  isWinningAsset,
  loadStrandedPosition,
  loadTradingContext,
  pickRecoveryTarget,
  quantityRawFromShares,
  resolveRedeemModeForDeposit,
  resolveWinningOutcomeForPosition,
  scanCtfBalances,
  truncateAddress,
  fetchPusdBalanceRaw,
  type RedemptionWalletMode,
} from './shared.js';

loadMonorepoEnv();

const { values } = parseArgs({
  options: {
    'position-id': { type: 'string', default: '22441' },
    'condition-id': { type: 'string' },
    wallet: { type: 'string' },
    mode: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: npx tsx tools/recover-stranded-redemption/02-redeem.ts [options]

Options:
  --position-id <id>       Position cible (défaut: 22441)
  --condition-id <hex>     Alternative
  --wallet <address>       Forcer le wallet (doit avoir le solde CTF)
  --mode deposit|proxy|safe  Forcer le mode relayer (avec --wallet)
  --dry-run                Affiche le plan sans envoyer de tx (recommandé)
  --confirm                EXÉCUTE le rachat on-chain (irréversible)

Workflow:
  1. 01-diagnose.ts
  2. 02-redeem.ts --dry-run
  3. 02-redeem.ts --confirm`);
  process.exit(0);
}

const dryRun = values['dry-run'] || !values.confirm;
if (!dryRun && !values.confirm) {
  console.error('Refus: ajoutez --confirm pour exécuter, ou --dry-run pour simuler.');
  process.exit(1);
}

function parseMode(raw: string | undefined): RedemptionWalletMode | null {
  if (!raw) return null;
  if (raw === 'deposit' || raw === 'proxy' || raw === 'safe') return raw;
  throw new Error(`mode invalide: ${raw}`);
}

async function main() {
  const pool = createRecoveryPool();
  try {
    const positionId = values['condition-id']
      ? undefined
      : Number(values['position-id']);
    const pos = await loadStrandedPosition(pool, {
      positionId: Number.isFinite(positionId) ? positionId : undefined,
      conditionId: values['condition-id'],
    });
    if (!pos) {
      console.error('Position introuvable.');
      process.exit(1);
    }

    const winningOutcome = resolveWinningOutcomeForPosition(pos);
    if (!winningOutcome) {
      console.error('Marché sans winning outcome résolu en base.');
      process.exit(1);
    }
    if (!isWinningAsset(pos)) {
      console.error('La position ne détient pas le token gagnant — rachat inutile.');
      process.exit(1);
    }

    const { ctx, signerAddress } = await loadTradingContext(pool);
    const candidates = buildWalletCandidates(ctx, signerAddress);
    const balances = await scanCtfBalances(pos.asset_id, candidates);

    let targetShares = 0;
    let targetWallet = values.wallet?.trim() ?? '';
    let redeemMode = parseMode(values.mode);

    if (targetWallet) {
      const row = balances.find(
        (b) => b.address.toLowerCase() === targetWallet.toLowerCase(),
      );
      if (!row || row.balanceRaw <= 0n) {
        console.error(`Wallet ${truncateAddress(targetWallet)} sans solde CTF.`);
        process.exit(1);
      }
      targetShares = row.balanceShares;
      if (!redeemMode) {
        const cand = candidates.find(
          (c) => c.address.toLowerCase() === targetWallet.toLowerCase(),
        );
        redeemMode = cand?.suggestedMode ?? null;
      }
    } else {
      const recovery = pickRecoveryTarget(balances, candidates);
      if (!recovery) {
        console.error('Aucun wallet avec parts + mode relayer connu. Utilisez --wallet et --mode.');
        process.exit(1);
      }
      targetWallet = recovery.balance.address;
      targetShares = recovery.balance.balanceShares;
      redeemMode = recovery.mode;
    }

    if (!redeemMode) {
      redeemMode = resolveRedeemModeForDeposit(
        signerAddress,
        ctx.depositAddress!,
        ctx.merged.signatureType ?? 3,
      );
    }

    const quantityRaw = quantityRawFromShares(targetShares);
    const pusdBefore = await fetchPusdBalanceRaw(ctx.depositAddress!);

    const plan = {
      dry_run: dryRun,
      position_id: pos.id,
      condition_id: pos.condition_id,
      winning_outcome: winningOutcome,
      neg_risk: pos.neg_risk,
      holder_wallet: truncateAddress(targetWallet),
      holder_shares: targetShares,
      quantity_raw: quantityRaw,
      relayer_mode: redeemMode,
      deposit_address: truncateAddress(ctx.depositAddress!),
      estimated_pusd_credit: targetShares,
      pusd_before: pusdRawToNumber(pusdBefore),
    };

    console.log('=== PLAN DE RACHAT ===');
    console.log(JSON.stringify(plan, null, 2));

    if (dryRun) {
      console.log('\n[DRY-RUN] Aucune transaction envoyée.');
      console.log('Pour exécuter:');
      console.log(
        `  npx tsx tools/recover-stranded-redemption/02-redeem.ts --position-id ${pos.id} --confirm`,
      );
      return;
    }

    console.log('\n[CONFIRM] Envoi du rachat on-chain…');
    const { redeemOnChain } = await import('../../packages/backend/dist/polymarket/clob-redeem.js');
    const result = await redeemOnChain(ctx.merged, ctx.depositAddress!, {
      conditionId: pos.condition_id,
      winningOutcome,
      quantityRaw,
      negRisk: pos.neg_risk,
      mode: redeemMode,
      signerPkEnc: ctx.merged.signerPkEnc ?? null,
      assetId: pos.asset_id,
    });

    const pusdAfter = await fetchPusdBalanceRaw(ctx.depositAddress!);
    const redeemedUsdc = pusdRawToNumber(BigInt(result.amountRedeemedRaw || '0'));

    console.log('\n=== RÉSULTAT ===');
    console.log({
      success: result.success,
      tx_hash: result.txHash || null,
      amount_redeemed_raw: result.amountRedeemedRaw,
      amount_redeemed_usdc: redeemedUsdc,
      collateral_slug: result.collateralSlug ?? null,
      wrapped_to_pusd: result.wrappedToPusd ?? null,
      wrap_tx_hash: result.wrapTxHash ?? null,
      wrap_error: result.wrapError ?? null,
      error: result.error ?? null,
      pusd_before: plan.pusd_before,
      pusd_after: pusdRawToNumber(pusdAfter),
      pusd_delta: pusdRawToNumber(pusdAfter - pusdBefore),
    });

    if (!result.success || result.amountRedeemedRaw === '0') {
      console.error(
        '\nÉCHEC: payout on-chain nul ou tx en erreur.\n' +
          'Ne pas mettre à jour la position en base. Essayez un autre --mode ou Polymarket UI.',
      );
      process.exit(1);
    }

    if (result.wrappedToPusd === false && result.wrapError) {
      console.warn(
        '\nATTENTION: redeem OK mais wrap USDC.e→pUSD échoué. Lancez 05-wrap-usdce-to-pusd.ts si besoin.',
      );
    }
    console.log('\nSUCCÈS: fonds sur le deposit wallet. Retrait vers EOA via UI Wallet si besoin.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
