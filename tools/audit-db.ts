import { createDataSource, initializeDataSource } from '../packages/core/src/database/data-source';
import path from 'path';

async function main() {
  const ds = createDataSource(path.resolve('./data/polywatch.db'));
  await initializeDataSource(ds);

  // 1. Simulation balance
  const balances = await ds.query('SELECT * FROM simulation_balances');
  console.log('=== SIMULATION BALANCE ===');
  console.log(JSON.stringify(balances, null, 2));

  // 2. All copied positions with PnL
  const positions = await ds.query(
    `SELECT id, condition_id, outcome, status, mode, quantity, entry_price, entry_bid_vwap,
            executable_bid_vwap, realized_pnl, unrealized_pnl, entry_fees, entry_fees_remaining,
            opened_at, closed_at, close_reason, increase_count
     FROM copied_positions ORDER BY opened_at`
  );
  console.log('\n=== ALL COPIED POSITIONS ===');
  positions.forEach((p: any) => console.log(JSON.stringify(p)));

  // 3. All executions
  const executions = await ds.query(
    `SELECT id, position_id, side, status, fill_price, fill_quantity, fees, realized_pnl, executed_at
     FROM executions ORDER BY executed_at`
  );
  console.log('\n=== ALL EXECUTIONS ===');
  executions.forEach((e: any) => console.log(JSON.stringify(e)));

  // 4. Risk config
  const riskConfig = await ds.query('SELECT * FROM risk_config LIMIT 1');
  console.log('\n=== RISK CONFIG ===');
  console.log(JSON.stringify(riskConfig, null, 2));

  // 5. Summary calculations
  console.log('\n=== SUMMARY ===');
  const cash = balances[0]?.amount ?? 0;
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
  console.log(`Equity (cash + mark value): ${(cash + openPositionValue).toFixed(2)}`);

  // 6. Cash flow trace: sum all execution cash impacts
  const buyExecs = executions.filter((e: any) => e.side === 'BUY' && e.status === 'filled');
  const sellExecs = executions.filter((e: any) => e.side === 'SELL' && e.status === 'filled');

  const totalBuyCost = buyExecs.reduce((s: number, e: any) => s + e.fill_price * e.fill_quantity + (e.fees ?? 0), 0);
  const totalSellProceeds = sellExecs.reduce((s: number, e: any) => s + e.fill_price * e.fill_quantity - (e.fees ?? 0), 0);

  console.log('\n=== CASH FLOW TRACE ===');
  console.log(`Total BUY cost (price*qty + fees): ${totalBuyCost.toFixed(4)}`);
  console.log(`Total SELL proceeds (price*qty - fees): ${totalSellProceeds.toFixed(4)}`);
  console.log(`Net cash flow from trading: ${(totalSellProceeds - totalBuyCost).toFixed(4)}`);

  // Initial capital
  const initialCapital = riskConfig[0]?.sim_initial_capital ?? 10000;
  console.log(`Initial capital (from risk config): ${initialCapital}`);
  console.log(`Expected cash = initial + net flow: ${(initialCapital + totalSellProceeds - totalBuyCost).toFixed(4)}`);
  console.log(`Actual cash: ${cash.toFixed(4)}`);
  console.log(`Discrepancy: ${(cash - (initialCapital + totalSellProceeds - totalBuyCost)).toFixed(4)}`);

  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
