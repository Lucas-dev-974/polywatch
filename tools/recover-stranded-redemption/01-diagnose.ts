#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Localise les parts CTF gagnantes non converties en pUSD.
 *
 * Usage:
 *   npx tsx tools/recover-stranded-redemption/01-diagnose.ts
 *   npx tsx tools/recover-stranded-redemption/01-diagnose.ts --position-id 22441
 *   npx tsx tools/recover-stranded-redemption/01-diagnose.ts --condition-id 0x6340f14a...
 *
 * Ne modifie rien on-chain. Nécessite DATABASE_URL + POLYGON_RPC_URL dans .env
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
  parseRedemptionPayoutFromReceipt,
  pickRecoveryTarget,
  resolveWinningOutcomeForPosition,
  scanCtfBalances,
  truncateAddress,
  fetchPusdBalanceRaw,
} from './shared.js';

loadMonorepoEnv();

const { values } = parseArgs({
  options: {
    'position-id': { type: 'string', default: '22441' },
    'condition-id': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: npx tsx tools/recover-stranded-redemption/01-diagnose.ts [options]

Options:
  --position-id <id>     Position réelle à inspecter (défaut: 22441)
  --condition-id <hex>   Alternative au position-id

Sortie: soldes CTF par wallet candidat, payout de la tx REDEMPTION précédente,
        et recommandation pour 02-redeem.ts`);
  process.exit(0);
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

    const { ctx, signerAddress } = await loadTradingContext(pool);
    const candidates = buildWalletCandidates(ctx, signerAddress);
    const winningOutcome = resolveWinningOutcomeForPosition(pos);
    const balances = await scanCtfBalances(pos.asset_id, candidates);
    const recovery = pickRecoveryTarget(balances, candidates);

    console.log('=== POSITION ===');
    console.log({
      id: pos.id,
      slug: pos.slug,
      question: pos.question,
      status: pos.status,
      close_reason: pos.close_reason,
      entry_price: pos.entry_price,
      db_realized_pnl: pos.realized_pnl,
      asset_id: `${pos.asset_id.slice(0, 12)}…`,
      winning_outcome: winningOutcome,
      held_winning_side: isWinningAsset(pos),
      market_resolved: pos.resolved,
      neg_risk: pos.neg_risk,
    });

    if (pos.redeem_tx_hash) {
      const prior = await parseRedemptionPayoutFromReceipt(pos.redeem_tx_hash);
      console.log('\n=== RACHAT POLYWATCH PRÉCÉDENT ===');
      console.log({
        tx_hash: pos.redeem_tx_hash,
        executed_at: pos.redeem_executed_at,
        on_chain_payout_usdc: prior.payoutRaw != null ? pusdRawToNumber(prior.payoutRaw) : null,
        index_sets: prior.indexSets?.map(String) ?? null,
      });
    }

    console.log('\n=== SOLDES CTF (parts outcome) ===');
    for (const row of balances) {
      console.log({
        wallet: row.label,
        address: truncateAddress(row.address),
        shares: row.balanceShares,
        raw: row.balanceRaw.toString(),
      });
    }

    const depositPusd = ctx.depositAddress
      ? await fetchPusdBalanceRaw(ctx.depositAddress)
      : 0n;
    console.log('\n=== pUSD DEPOSIT (avant recovery) ===');
    console.log({
      address: ctx.depositAddress ? truncateAddress(ctx.depositAddress) : null,
      pusd: pusdRawToNumber(depositPusd),
    });

    console.log('\n=== VERDICT ===');
    const totalShares = balances.reduce((s, b) => s + b.balanceShares, 0);
    if (totalShares <= 0) {
      console.log(
        'Aucune part CTF détectée sur les wallets candidats.\n' +
          '→ Récupération via ce script peu probable.\n' +
          '→ Vérifier manuellement sur polymarket.com (Portfolio) avec le même compte.',
      );
    } else if (!recovery) {
      console.log(
        `Parts détectées (${totalShares.toFixed(4)} shares) mais mode relayer ambigu.\n` +
          '→ Relancer 02-redeem.ts avec --wallet et --mode explicites après revue.',
      );
    } else {
      const estPayout = recovery.balance.balanceShares;
      console.log(
        `RÉCUPÉRATION POSSIBLE: ~${estPayout.toFixed(4)} USDC si rachat réussi.\n` +
          `Wallet cible: ${recovery.balance.label} (${truncateAddress(recovery.balance.address)})\n` +
          `Mode relayer suggéré: ${recovery.mode}\n` +
          `Commande (dry-run d'abord):\n` +
          `  npx tsx tools/recover-stranded-redemption/02-redeem.ts --position-id ${pos.id} --dry-run\n` +
          `Puis si OK:\n` +
          `  npx tsx tools/recover-stranded-redemption/02-redeem.ts --position-id ${pos.id} --confirm`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
