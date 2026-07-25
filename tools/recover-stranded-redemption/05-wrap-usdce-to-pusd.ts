#!/usr/bin/env npx tsx
/**
 * WRAP USDC.e → pUSD via le collateral on-ramp Polymarket (deposit wallet).
 *
 * Usage:
 *   npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --dry-run
 *   npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --confirm
 *   npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --confirm --amount 5.060235
 */
import { parseArgs } from 'node:util';
import { ethers } from 'ethers';
import { loadMonorepoEnv } from '../../packages/core/src/config/env.js';
import { pusdRawToNumber, amountToRaw6Decimals } from '../../packages/core/src/polymarket/pusd-amount.js';
import {
  createRecoveryPool,
  createPolygonProvider,
  fetchErc20BalanceRaw,
  fetchPusdBalanceRaw,
  loadTradingContext,
  truncateAddress,
} from './shared.js';

loadMonorepoEnv();

const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const COLLATERAL_ONRAMP_ADDRESS = '0x93070a847efEf7F70739046A929D47a521F5B8ee';

const { values } = parseArgs({
  options: {
    amount: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts [options]

Options:
  --amount <usdc>   Montant à convertir (défaut: solde USDC.e complet du deposit)
  --dry-run         Affiche le plan sans envoyer de tx
  --confirm         EXÉCUTE la conversion on-chain`);
  process.exit(0);
}

const dryRun = !values.confirm;

function buildWrapDepositWalletCalls(recipient: string, amountRaw: bigint) {
  const erc20Iface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
  ]);
  const onrampIface = new ethers.Interface([
    'function wrap(address _asset, address _to, uint256 _amount) external',
  ]);

  return [
    {
      target: USDC_E_ADDRESS,
      value: '0',
      data: erc20Iface.encodeFunctionData('approve', [
        COLLATERAL_ONRAMP_ADDRESS,
        amountRaw,
      ]),
    },
    {
      target: COLLATERAL_ONRAMP_ADDRESS,
      value: '0',
      data: onrampIface.encodeFunctionData('wrap', [
        USDC_E_ADDRESS,
        recipient,
        amountRaw,
      ]),
    },
  ];
}

async function main() {
  const pool = createRecoveryPool();
  try {
    const { ctx } = await loadTradingContext(pool);
    const deposit = ctx.depositAddress!;

    const usdceBefore = await fetchErc20BalanceRaw(USDC_E_ADDRESS, deposit);
    if (usdceBefore <= 0n) {
      console.error('Aucun USDC.e sur le deposit wallet — rien à convertir.');
      process.exit(1);
    }

    let amountRaw = usdceBefore;
    if (values.amount) {
      amountRaw = amountToRaw6Decimals(Number(values.amount));
      if (amountRaw > usdceBefore) {
        console.error(
          `Montant demandé (${values.amount}) > solde USDC.e (${pusdRawToNumber(usdceBefore)}).`,
        );
        process.exit(1);
      }
    }

    const pusdBefore = await fetchPusdBalanceRaw(deposit);

    const plan = {
      dry_run: dryRun,
      deposit_wallet: truncateAddress(deposit),
      usdce_before: pusdRawToNumber(usdceBefore),
      amount_to_wrap: pusdRawToNumber(amountRaw),
      pusd_before: pusdRawToNumber(pusdBefore),
      estimated_pusd_after: pusdRawToNumber(pusdBefore + amountRaw),
      onramp: COLLATERAL_ONRAMP_ADDRESS,
    };

    console.log('=== PLAN CONVERSION USDC.e → pUSD ===');
    console.log(JSON.stringify(plan, null, 2));

    if (dryRun) {
      console.log('\n[DRY-RUN] Aucune transaction envoyée.');
      console.log(
        'Pour exécuter:\n' +
          '  npx tsx tools/recover-stranded-redemption/05-wrap-usdce-to-pusd.ts --confirm',
      );
      return;
    }

    console.log('\n[CONFIRM] Envoi du wrap on-chain (relayer, mode deposit)…');
    const { createRelayClient, waitForTxHash } = await import(
      '../../packages/backend/dist/polymarket/relayer-client.js'
    );
    const { buildDepositWalletDeadline } = await import(
      '../../packages/backend/dist/polymarket/deposit-wallet-signing.js'
    );
    const { decrypt } = await import('../../packages/backend/dist/crypto/encryption.js');

    if (!ctx.merged.signerPkEnc) {
      console.error('Signer manquant.');
      process.exit(1);
    }

    const signerPrivateKey = decrypt(ctx.merged.signerPkEnc);
    const client = createRelayClient(ctx.merged as never, signerPrivateKey, 'deposit');
    const calls = buildWrapDepositWalletCalls(deposit, amountRaw);
    const response = await client.executeDepositWalletBatch(
      calls,
      deposit,
      buildDepositWalletDeadline(false),
    );
    const txHash = await waitForTxHash(response);
    console.log('Tx:', txHash);

    const provider = createPolygonProvider();
    const receipt = await provider.getTransactionReceipt(txHash);

    const usdceAfter = await fetchErc20BalanceRaw(USDC_E_ADDRESS, deposit);
    const pusdAfter = await fetchPusdBalanceRaw(deposit);

    console.log('\n=== RÉSULTAT ===');
    console.log({
      tx_hash: txHash,
      tx_status: receipt?.status ?? null,
      usdce_before: plan.usdce_before,
      usdce_after: pusdRawToNumber(usdceAfter),
      usdce_delta: pusdRawToNumber(usdceAfter - usdceBefore),
      pusd_before: plan.pusd_before,
      pusd_after: pusdRawToNumber(pusdAfter),
      pusd_delta: pusdRawToNumber(pusdAfter - pusdBefore),
    });

    if (pusdAfter <= pusdBefore) {
      console.error('\nÉCHEC: solde pUSD inchangé après le wrap.');
      process.exit(1);
    }

    console.log(
      `\nSUCCÈS: +${pusdRawToNumber(pusdAfter - pusdBefore)} pUSD crédités sur le deposit wallet.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
