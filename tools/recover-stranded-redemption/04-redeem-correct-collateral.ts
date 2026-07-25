#!/usr/bin/env npx tsx
/**
 * RACHAT ON-CHAIN (collatéral corrigé) — redeemPositions avec le collatéral
 * réel du marché (détecté via getPositionId), au lieu du pUSD codé en dur
 * dans le backend qui produit un payout 0.
 *
 * SÉCURITÉ:
 *   - Par défaut: dry-run (aucune transaction)
 *   - Exécution réelle: --confirm obligatoire
 *
 * Usage:
 *   npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts --position-id 22441 --dry-run
 *   npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts --position-id 22441 --confirm
 */
import { parseArgs } from 'node:util';
import { ethers } from 'ethers';
import { loadMonorepoEnv } from '../../packages/core/src/config/env.js';
import { pusdRawToNumber } from '../../packages/core/src/polymarket/pusd-amount.js';
import { POLYGON_CLOB_CONTRACTS_V2 } from '../../packages/core/src/polymarket/clob-contracts.js';
import {
  createRecoveryPool,
  createPolygonProvider,
  detectCollateralForAsset,
  fetchConditionPayoutDenominator,
  fetchCtfBalance,
  fetchErc20BalanceRaw,
  loadStrandedPosition,
  loadTradingContext,
  resolveWinningOutcomeForPosition,
  isWinningAsset,
  truncateAddress,
} from './shared.js';

loadMonorepoEnv();

const { values } = parseArgs({
  options: {
    'position-id': { type: 'string', default: '22441' },
    'dry-run': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts [options]

Options:
  --position-id <id>   Position cible (défaut: 22441)
  --dry-run            Affiche le plan sans envoyer de tx (défaut si pas --confirm)
  --confirm            EXÉCUTE le rachat on-chain (irréversible)`);
  process.exit(0);
}

const dryRun = !values.confirm;

async function main() {
  const pool = createRecoveryPool();
  try {
    const pos = await loadStrandedPosition(pool, {
      positionId: Number(values['position-id']),
    });
    if (!pos) {
      console.error('Position introuvable.');
      process.exit(1);
    }

    const winningOutcome = resolveWinningOutcomeForPosition(pos);
    if (!winningOutcome || !isWinningAsset(pos)) {
      console.error('Position sans token gagnant — rachat inutile.');
      process.exit(1);
    }

    // 1. Détecter le collatéral réel du marché à partir de l'asset détenu
    const collateral = await detectCollateralForAsset(pos.condition_id, pos.asset_id);
    if (!collateral) {
      console.error(
        'Impossible de retrouver le collatéral: asset_id ne correspond à aucun ' +
          'positionId CTF calculé (pUSD / USDC.e / USDC natif).',
      );
      process.exit(1);
    }

    // 2. Vérifier la résolution on-chain
    const denominator = await fetchConditionPayoutDenominator(pos.condition_id);
    if (denominator === 0n) {
      console.error('Condition NON résolue on-chain — le rachat paierait 0.');
      process.exit(1);
    }

    const { ctx } = await loadTradingContext(pool);
    const deposit = ctx.depositAddress!;

    const ctfBalance = await fetchCtfBalance(deposit, pos.asset_id);
    if (ctfBalance <= 0n) {
      console.error('Aucune part CTF sur le deposit wallet — rien à racheter.');
      process.exit(1);
    }

    const collateralBefore = await fetchErc20BalanceRaw(collateral.address, deposit);

    const indexSet = BigInt(collateral.indexSet);
    const iface = new ethers.Interface([
      'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets)',
    ]);
    const calldata = iface.encodeFunctionData('redeemPositions', [
      collateral.address,
      ethers.ZeroHash,
      pos.condition_id,
      [indexSet],
    ]);

    const plan = {
      dry_run: dryRun,
      position_id: pos.id,
      condition_id: pos.condition_id,
      winning_outcome: winningOutcome,
      detected_collateral: `${collateral.label} (${collateral.address})`,
      index_set: collateral.indexSet,
      deposit_wallet: truncateAddress(deposit),
      ctf_shares: pusdRawToNumber(ctfBalance),
      collateral_balance_before: pusdRawToNumber(collateralBefore),
      estimated_credit: pusdRawToNumber(ctfBalance),
      target_contract: POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    };

    console.log('=== PLAN DE RACHAT (collatéral corrigé) ===');
    console.log(JSON.stringify(plan, null, 2));

    if (dryRun) {
      console.log('\n[DRY-RUN] Aucune transaction envoyée.');
      console.log('Pour exécuter:');
      console.log(
        `  npx tsx tools/recover-stranded-redemption/04-redeem-correct-collateral.ts --position-id ${pos.id} --confirm`,
      );
      return;
    }

    console.log('\n[CONFIRM] Envoi du rachat on-chain (relayer, mode deposit)…');
    const { createRelayClient, waitForTxHash } = await import(
      '../../packages/backend/dist/polymarket/relayer-client.js'
    );
    const { buildDepositWalletDeadline } = await import(
      '../../packages/backend/dist/polymarket/deposit-wallet-signing.js'
    );
    const { decrypt } = await import('../../packages/backend/dist/crypto/encryption.js');

    if (!ctx.merged.signerPkEnc) {
      console.error('Signer manquant — impossible de signer la tx relayer.');
      process.exit(1);
    }
    const signerPrivateKey = decrypt(ctx.merged.signerPkEnc);
    const client = createRelayClient(ctx.merged as never, signerPrivateKey, 'deposit');
    const response = await client.executeDepositWalletBatch(
      [
        {
          target: POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
          value: '0',
          data: calldata,
        },
      ],
      deposit,
      buildDepositWalletDeadline(false),
    );
    const txHash = await waitForTxHash(response);
    console.log('Tx:', txHash);

    // Vérification: PayoutRedemption.payout doit être > 0
    const provider = createPolygonProvider();
    const receipt = await provider.getTransactionReceipt(txHash);
    let payoutRaw: bigint | null = null;
    if (receipt) {
      const evIface = new ethers.Interface([
        'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
      ]);
      for (const log of receipt.logs) {
        try {
          const parsed = evIface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'PayoutRedemption') {
            payoutRaw = parsed.args.payout as bigint;
          }
        } catch {
          // pas un event PayoutRedemption
        }
      }
    }

    const collateralAfter = await fetchErc20BalanceRaw(collateral.address, deposit);
    const ctfAfter = await fetchCtfBalance(deposit, pos.asset_id);

    console.log('\n=== RÉSULTAT ===');
    console.log({
      tx_hash: txHash,
      tx_status: receipt?.status ?? null,
      on_chain_payout: payoutRaw != null ? pusdRawToNumber(payoutRaw) : null,
      ctf_shares_after: pusdRawToNumber(ctfAfter),
      collateral_before: pusdRawToNumber(collateralBefore),
      collateral_after: pusdRawToNumber(collateralAfter),
      collateral_delta: pusdRawToNumber(collateralAfter - collateralBefore),
      collateral_token: collateral.label,
    });

    if (payoutRaw == null || payoutRaw === 0n) {
      console.error('\nÉCHEC: payout toujours nul. Ne pas retenter sans nouvelle analyse.');
      process.exit(1);
    }

    console.log(
      `\nSUCCÈS: ${pusdRawToNumber(payoutRaw)} ${collateral.label} crédités sur le deposit wallet.`,
    );
    if (collateral.label !== 'pUSD') {
      console.log(
        'Note: le crédit est en ' + collateral.label + ', pas en pUSD. ' +
          'Conversion vers pUSD possible via le collateral on-ramp Polymarket si besoin.',
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
