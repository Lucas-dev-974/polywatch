#!/usr/bin/env npx tsx
/**
 * Ops: wrap stranded USDC.e → pUSD + close position #22539 stuck in pending_resolution
 * after on-chain redeem already succeeded (CTF=0, USDC.e credited).
 *
 *   npx tsx tools/recover-stranded-redemption/06-fix-pos-22539.ts --dry-run
 *   npx tsx tools/recover-stranded-redemption/06-fix-pos-22539.ts --confirm
 */
import { parseArgs } from 'node:util';
import { loadMonorepoEnv } from '../../packages/core/src/config/env.js';
import {
  pusdRawToNumber,
} from '../../packages/core/src/polymarket/pusd-amount.js';
import {
  createRecoveryPool,
  fetchErc20BalanceRaw,
  fetchPusdBalanceRaw,
  loadTradingContext,
  truncateAddress,
} from './shared.js';

loadMonorepoEnv();

const POSITION_ID = 22539;
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
  },
});
const dryRun = !values.confirm;

async function main() {
  const pool = createRecoveryPool();
  try {
    const { ctx } = await loadTradingContext(pool);
    const deposit = ctx.depositAddress!;

    const posRes = await pool.query(
      `SELECT id, status, quantity, entry_price, entry_fees, realized_pnl
       FROM copied_positions WHERE id = $1`,
      [POSITION_ID],
    );
    const pos = posRes.rows[0];
    if (!pos) throw new Error('position_not_found');

    const execRes = await pool.query(
      `SELECT id, status, order_signal_id, fill_price, fill_quantity, error, tx_hash
       FROM executions
       WHERE copied_position_id = $1 AND reason = 'REDEMPTION'
       ORDER BY id DESC LIMIT 1`,
      [POSITION_ID],
    );
    const exec = execRes.rows[0];

    const usdce = await fetchErc20BalanceRaw(USDC_E, deposit);
    const pusdBefore = await fetchPusdBalanceRaw(deposit);

    const qty = Number(pos.quantity);
    const entryPrice = Number(pos.entry_price);
    const entryFees = Number(pos.entry_fees ?? 0);
    const fillPrice = 1;
    const proceeds = qty * fillPrice;
    const cost = qty * entryPrice + entryFees;
    const realizedPnl = proceeds - cost;

    const plan = {
      dry_run: dryRun,
      deposit: truncateAddress(deposit),
      position: { id: pos.id, status: pos.status, qty, entryPrice, entryFees },
      redemption_exec: exec
        ? { id: exec.id, status: exec.status, order_signal_id: exec.order_signal_id }
        : null,
      usdce_to_wrap: pusdRawToNumber(usdce),
      pusd_before: pusdRawToNumber(pusdBefore),
      accounting: { proceeds, cost, realizedPnl },
    };
    console.log('=== PLAN ===');
    console.log(JSON.stringify(plan, null, 2));

    if (dryRun) {
      console.log('\n[DRY-RUN] Aucune action. Relancer avec --confirm');
      return;
    }

    // 1) Wrap USDC.e → pUSD if any
    let wrapTx: string | null = null;
    if (usdce > 0n) {
      console.log('\n[1] Wrap USDC.e → pUSD…');
      const { createRelayClient, waitForTxHash } = await import(
        '../../packages/backend/dist/polymarket/relayer-client.js'
      );
      const { buildDepositWalletDeadline } = await import(
        '../../packages/backend/dist/polymarket/deposit-wallet-signing.js'
      );
      const { decrypt } = await import(
        '../../packages/backend/dist/crypto/encryption.js'
      );
      const { buildWrapDepositWalletCalls } = await import(
        '../../packages/backend/dist/polymarket/collateral-ramp.js'
      );

      if (!ctx.merged.signerPkEnc) throw new Error('signer_missing');
      // Rebuild dist may lag — encode locally if buildWrap missing
      let calls: Array<{ target: string; value: string; data: string }>;
      try {
        calls = buildWrapDepositWalletCalls(deposit, usdce);
      } catch {
        const { ethers } = await import('ethers');
        const erc20 = new ethers.Interface([
          'function approve(address spender, uint256 amount) returns (bool)',
        ]);
        const onramp = new ethers.Interface([
          'function wrap(address _asset, address _to, uint256 _amount) external',
        ]);
        const ONRAMP = '0x93070a847efEf7F70739046A929D47a521F5B8ee';
        calls = [
          {
            target: USDC_E,
            value: '0',
            data: erc20.encodeFunctionData('approve', [ONRAMP, usdce]),
          },
          {
            target: ONRAMP,
            value: '0',
            data: onramp.encodeFunctionData('wrap', [USDC_E, deposit, usdce]),
          },
        ];
      }

      const signerPk = decrypt(ctx.merged.signerPkEnc);
      const client = createRelayClient(ctx.merged as never, signerPk, 'deposit');
      const response = await client.executeDepositWalletBatch(
        calls,
        deposit,
        buildDepositWalletDeadline(false),
      );
      wrapTx = await waitForTxHash(response);
      console.log('Wrap tx:', wrapTx);
    } else {
      console.log('\n[1] Pas d’USDC.e à wrapper');
    }

    const pusdAfter = await fetchPusdBalanceRaw(deposit);
    const usdceAfter = await fetchErc20BalanceRaw(USDC_E, deposit);

    // 2) Fix DB — finalize redemption + close position
    console.log('\n[2] Correction BDD…');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (exec) {
        await client.query(
          `UPDATE executions
           SET status = 'filled',
               fill_price = $1,
               fill_quantity = $2,
               realized_pnl = $3,
               fees = 0,
               error = NULL,
               tx_hash = COALESCE(tx_hash, $4),
               executed_at = COALESCE(executed_at, NOW())
           WHERE id = $5`,
          [
            fillPrice,
            qty,
            realizedPnl,
            wrapTx,
            exec.id,
          ],
        );
      }
      await client.query(
        `UPDATE copied_positions
         SET status = 'closed',
             close_reason = 'REDEMPTION',
             quantity = 0,
             entry_quantity_remaining = 0,
             realized_pnl = $1,
             unrealized_pnl = 0,
             closed_at = COALESCE(closed_at, NOW())
         WHERE id = $2`,
        [realizedPnl, POSITION_ID],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    console.log('\n=== RÉSULTAT ===');
    console.log({
      wrap_tx: wrapTx,
      usdce_after: pusdRawToNumber(usdceAfter),
      pusd_before: pusdRawToNumber(pusdBefore),
      pusd_after: pusdRawToNumber(pusdAfter),
      pusd_delta: pusdRawToNumber(pusdAfter - pusdBefore),
      realized_pnl: realizedPnl,
      position_closed: true,
    });
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
