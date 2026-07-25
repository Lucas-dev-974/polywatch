import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    // 1. Cash balance
    const balanceRes = await client.query('SELECT amount FROM simulation_balances LIMIT 1');
    const cash = Number(balanceRes.rows[0]?.amount ?? 0);
    console.log(`Cash balance: ${cash.toFixed(4)}`);

    // 2. Initial capital
    const rcRes = await client.query('SELECT sim_initial_capital FROM risk_config LIMIT 1');
    const initialCapital = Number(rcRes.rows[0]?.sim_initial_capital ?? 10000);
    console.log(`Initial capital: ${initialCapital}`);

    // 3. All sim positions summary
    const simPositionsRes = await client.query(`
      SELECT status, COUNT(*) as cnt, SUM(realized_pnl) as total_realized, SUM(unrealized_pnl) as total_unrealized,
             SUM(quantity * COALESCE(executable_bid_vwap, entry_price, 0)) as total_mark_value
      FROM copied_positions WHERE mode = 'sim'
      GROUP BY status
    `);
    const simPositions = simPositionsRes.rows;
    console.log('\n=== SIM POSITIONS BY STATUS ===');
    simPositions.forEach((r: any) => console.log(`  ${r.status}: count=${r.cnt} realized_sum=${(Number(r.total_realized ?? 0)).toFixed(4)} unrealized_sum=${(Number(r.total_unrealized ?? 0)).toFixed(4)} mark_value=${(Number(r.total_mark_value ?? 0)).toFixed(4)}`));

    // 4. Cash flow from executions (sim only)
    const execsRes = await client.query(`
      SELECT e.side, e.status, SUM(e.fill_price * e.fill_quantity) as total_proceeds,
             SUM(e.fees) as total_fees, COUNT(*) as cnt
      FROM executions e
      JOIN copied_positions p ON e.copied_position_id = p.id
      WHERE p.mode = 'sim'
      GROUP BY e.side, e.status
    `);
    const execs = execsRes.rows;
    console.log('\n=== SIM EXECUTIONS ===');
    execs.forEach((r: any) => console.log(`  ${r.side} ${r.status}: count=${r.cnt} proceeds=${(Number(r.total_proceeds ?? 0)).toFixed(4)} fees=${(Number(r.total_fees ?? 0)).toFixed(4)}`));

    // 5. Net cash flow
    const buyFilled = execs.filter((e: any) => e.side === 'BUY' && e.status === 'filled');
    const sellFilled = execs.filter((e: any) => e.side === 'SELL' && e.status === 'filled');
    const totalBuyCost = buyFilled.reduce((s: number, e: any) => s + (Number(e.total_proceeds ?? 0)) + (Number(e.total_fees ?? 0)), 0);
    const totalSellProceeds = sellFilled.reduce((s: number, e: any) => s + (Number(e.total_proceeds ?? 0)) - (Number(e.total_fees ?? 0)), 0);
    console.log(`\nTotal BUY cost (proceeds+fees): ${totalBuyCost.toFixed(4)}`);
    console.log(`Total SELL credit (proceeds-fees): ${totalSellProceeds.toFixed(4)}`);
    console.log(`Net cash flow: ${(totalSellProceeds - totalBuyCost).toFixed(4)}`);
    console.log(`Expected cash: ${(initialCapital + totalSellProceeds - totalBuyCost).toFixed(4)}`);
    console.log(`Actual cash: ${cash.toFixed(4)}`);
    console.log(`DISCREPANCY: ${(cash - (initialCapital + totalSellProceeds - totalBuyCost)).toFixed(4)}`);

    // 6. Check for failed positions that consumed cash but never sold
    const failedPositionsRes = await client.query(`
      SELECT p.id, p.quantity, p.entry_price, p.entry_fees, p.unrealized_pnl, p.status
      FROM copied_positions p WHERE p.mode = 'sim' AND p.status = 'failed'
    `);
    console.log('\n=== FAILED POSITIONS (cash consumed, never sold) ===');
    let failedCashConsumed = 0;
    failedPositionsRes.rows.forEach((p: any) => {
      const cost = Number(p.entry_price) * Number(p.quantity) + Number(p.entry_fees);
      failedCashConsumed += cost;
      console.log(`  id=${p.id} qty=${p.quantity} entry=${p.entry_price} fees=${p.entry_fees} cost=${cost.toFixed(4)} unrealized=${(Number(p.unrealized_pnl ?? 0)).toFixed(4)}`);
    });
    console.log(`Total cash consumed by failed positions: ${failedCashConsumed.toFixed(4)}`);

    // 7. Check for open positions that consumed cash
    const openPositionsRes = await client.query(`
      SELECT p.id, p.quantity, p.entry_price, p.entry_fees, p.unrealized_pnl, p.status, p.executable_bid_vwap
      FROM copied_positions p WHERE p.mode = 'sim' AND p.status IN ('open', 'closing')
    `);
    console.log('\n=== OPEN POSITIONS (cash consumed, not yet sold) ===');
    let openCashConsumed = 0;
    openPositionsRes.rows.forEach((p: any) => {
      const cost = Number(p.entry_price) * Number(p.quantity) + Number(p.entry_fees);
      openCashConsumed += cost;
      console.log(`  id=${p.id} qty=${Number(p.quantity).toFixed(4)} entry=${p.entry_price} mark=${p.executable_bid_vwap} fees=${p.entry_fees} cost=${cost.toFixed(4)} unrealized=${(Number(p.unrealized_pnl ?? 0)).toFixed(4)}`);
    });
    console.log(`Total cash consumed by open positions: ${openCashConsumed.toFixed(4)}`);

    // 8. Check for REDEMPTION positions (sold at 0 or 1, no cash credit?)
    const redemptionExecsRes = await client.query(`
      SELECT e.id, e.copied_position_id, e.fill_price, e.fill_quantity, e.fees, e.realized_pnl, e.status, p.close_reason
      FROM executions e
      JOIN copied_positions p ON e.copied_position_id = p.id
      WHERE p.mode = 'sim' AND p.close_reason = 'REDEMPTION' AND e.side = 'SELL'
    `);
    console.log('\n=== REDEMPTION SELL EXECUTIONS ===');
    redemptionExecsRes.rows.forEach((e: any) => {
      console.log(`  exec_id=${e.id} pos_id=${e.copied_position_id} fill_price=${e.fill_price} qty=${e.fill_quantity} fees=${e.fees} realized_pnl=${e.realized_pnl} status=${e.status}`);
    });

    // 9. Check for cancelled positions that consumed cash
    const cancelledPositionsRes = await client.query(`
      SELECT p.id, p.quantity, p.entry_price, p.entry_fees
      FROM copied_positions p WHERE p.mode = 'sim' AND p.status = 'cancelled' AND p.quantity > 0
    `);
    console.log('\n=== CANCELLED POSITIONS WITH QTY > 0 ===');
    cancelledPositionsRes.rows.forEach((p: any) => console.log(`  id=${p.id} qty=${p.quantity} entry=${p.entry_price} fees=${p.entry_fees}`));

    // 10. Reconciliation
    console.log('\n=== RECONCILIATION ===');
    console.log(`Initial capital: ${initialCapital.toFixed(4)}`);
    console.log(`- BUY cost (filled): ${totalBuyCost.toFixed(4)}`);
    console.log(`+ SELL credit (filled): ${totalSellProceeds.toFixed(4)}`);
    console.log(`= Expected cash: ${(initialCapital + totalSellProceeds - totalBuyCost).toFixed(4)}`);
    console.log(`Actual cash: ${cash.toFixed(4)}`);
    console.log(`Gap: ${(cash - (initialCapital + totalSellProceeds - totalBuyCost)).toFixed(4)}`);

    // Check if gap equals failed positions cost
    console.log(`\nFailed positions cash consumed: ${failedCashConsumed.toFixed(4)}`);
    console.log(`Open positions cash consumed: ${openCashConsumed.toFixed(4)}`);
    console.log(`Failed + Open cash consumed: ${(failedCashConsumed + openCashConsumed).toFixed(4)}`);

    // The gap should be explained by: initial - buyCost + sellCredit = cash + openCost + failedCost
    // i.e. cash = initial - buyCost + sellCredit - openCost - failedCost
    console.log(`\nReconciliation check:`);
    console.log(`initial(${initialCapital.toFixed(4)}) - buyCost(${totalBuyCost.toFixed(4)}) + sellCredit(${totalSellProceeds.toFixed(4)}) - openCost(${openCashConsumed.toFixed(4)}) - failedCost(${failedCashConsumed.toFixed(4)})`);
    const reconciled = initialCapital - totalBuyCost + totalSellProceeds - openCashConsumed - failedCashConsumed;
    console.log(`= ${reconciled.toFixed(4)} (should equal cash: ${cash.toFixed(4)})`);
    console.log(`Residual gap: ${(cash - reconciled).toFixed(4)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});