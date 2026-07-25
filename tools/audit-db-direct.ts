import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    console.log('=== SIMULATION BALANCE ===');
    const balancesRes = await client.query('SELECT * FROM simulation_balances');
    console.log(JSON.stringify(balancesRes.rows, null, 2));

    console.log('\n=== ALL COPIED POSITIONS ===');
    const positionsRes = await client.query(`
      SELECT id, condition_id, outcome, status, mode, quantity, entry_price, entry_bid_vwap,
             executable_bid_vwap, realized_pnl, unrealized_pnl, entry_fees, entry_fees_remaining,
             opened_at, closed_at, close_reason, increase_count
      FROM copied_positions ORDER BY opened_at
    `);
    positionsRes.rows.forEach((p: any) => console.log(JSON.stringify(p)));

    console.log('\n=== ALL EXECUTIONS ===');
    const executionsRes = await client.query(`
      SELECT id, copied_position_id, side, status, fill_price, fill_quantity, fees, realized_pnl, executed_at
      FROM executions ORDER BY executed_at
    `);
    executionsRes.rows.forEach((e: any) => console.log(JSON.stringify(e)));

    console.log('\n=== RISK CONFIG ===');
    const riskConfigRes = await client.query('SELECT * FROM risk_config LIMIT 1');
    console.log(JSON.stringify(riskConfigRes.rows, null, 2));

    console.log('\n=== SUMMARY ===');
    const balances = balancesRes.rows;
    const positions = positionsRes.rows;
    const executions = executionsRes.rows;
    const cash = (balances[0] as any)?.amount ?? 0;
    console.log(`Cash balance: ${cash}`);

    const openPositions = positions.filter((p: any) => p.status === 'open' || p.status === 'closing');
    const closedPositions = positions.filter((p: any) => p.status === 'closed');

    const openUnrealizedSum = openPositions.reduce((s: number, p: any) => s + (p.unrealized_pnl ?? 0), 0);
    const closedRealizedSum = closedPositions.reduce((s: number, p: any) => s + (p.realized_pnl ?? 0), 0);
    const openPositionValue = openPositions.reduce((s: number, p: any) => s + (p.executable_bid_vwap ?? p.entry_price ?? 0) * (p.quantity ?? 0), 0);

    console.log(`Open positions count: ${openPositions.length}`);
    console.log(`Open positions unrealized PnL sum: ${openUnrealizedSum.toFixed(2)}`);
    console.log(`Open positions mark value: ${openPositionValue.toFixed(2)}`);
    console.log(`Closed positions count: ${closedPositions.length}`);
    console.log(`Closed positions realized PnL sum: ${closedRealizedSum.toFixed(2)}`);
    console.log(`Equity (cash + mark value): ${(Number(cash) + openPositionValue).toFixed(2)}`);

    console.log('\n=== CASH FLOW TRACE ===');
    const buyExecs = executions.filter((e: any) => e.side === 'BUY' && e.status === 'filled');
    const sellExecs = executions.filter((e: any) => e.side === 'SELL' && e.status === 'filled');

    const totalBuyCost = buyExecs.reduce((s: number, e: any) => s + Number(e.fill_price) * Number(e.fill_quantity) + (Number(e.fees) ?? 0), 0);
    const totalSellProceeds = sellExecs.reduce((s: number, e: any) => s + Number(e.fill_price) * Number(e.fill_quantity) - (Number(e.fees) ?? 0), 0);

    console.log(`Total BUY cost (price*qty + fees): ${totalBuyCost.toFixed(4)}`);
    console.log(`Total SELL proceeds (price*qty - fees): ${totalSellProceeds.toFixed(4)}`);
    console.log(`Net cash flow from trading: ${(totalSellProceeds - totalBuyCost).toFixed(4)}`);

    const initialCapital = (riskConfigRes.rows[0] as any)?.sim_initial_capital ?? 10000;
    console.log(`Initial capital (from risk config): ${initialCapital}`);
    console.log(`Expected cash = initial + net flow: ${(Number(initialCapital) + totalSellProceeds - totalBuyCost).toFixed(4)}`);
    console.log(`Actual cash: ${Number(cash).toFixed(4)}`);
    console.log(`Discrepancy: ${(Number(cash) - (Number(initialCapital) + totalSellProceeds - totalBuyCost)).toFixed(4)}`);

    // Detailed per-position breakdown
    console.log('\n=== PER-POSITION BREAKDOWN ===');
    for (const p of positions as any[]) {
      const posExecs = executions.filter((e: any) => e.copied_position_id === p.id);
      const buyCost = posExecs.filter((e: any) => e.side === 'BUY').reduce((s: number, e: any) => s + Number(e.fill_price) * Number(e.fill_quantity) + (Number(e.fees) ?? 0), 0);
      const sellProceeds = posExecs.filter((e: any) => e.side === 'SELL').reduce((s: number, e: any) => s + Number(e.fill_price) * Number(e.fill_quantity) - (Number(e.fees) ?? 0), 0);
      console.log(`Position ${p.id} [${p.status}] qty=${p.quantity} entry=${p.entry_price} mark=${p.executable_bid_vwap} realized=${p.realized_pnl} unrealized=${p.unrealized_pnl} fees=${p.entry_fees} fees_rem=${p.entry_fees_remaining} | buyCost=${buyCost.toFixed(4)} sellProceeds=${sellProceeds.toFixed(4)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});