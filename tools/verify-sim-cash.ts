import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
import {
  replaySimCashDelta,
  type SimExecutionCashRow,
} from '../packages/core/dist/simulation/accounting.js';

loadMonorepoEnv();

const TOLERANCE = 0.01;

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const balanceRes = await client.query(
    'SELECT amount, baseline_capital, token, updated_at FROM simulation_balances LIMIT 1',
  );
  const riskRes = await client.query(
    'SELECT sim_initial_capital FROM risk_config LIMIT 1',
  );
  const execRes = await client.query(`
    SELECT copied_position_id, side, reason, fill_price, fill_quantity, fees, status
    FROM executions
    WHERE mode = 'sim' AND status IN ('filled', 'partial')
    ORDER BY COALESCE(executed_at, '1970-01-01'), id
  `);
  const execCount = await client.query(`
    SELECT status, side, COUNT(*)::int AS n
    FROM executions WHERE mode = 'sim'
    GROUP BY status, side ORDER BY status, side
  `);
  const posCount = await client.query(`
    SELECT status, COUNT(*)::int AS n
    FROM copied_positions WHERE mode = 'sim'
    GROUP BY status ORDER BY status
  `);
  const openPos = await client.query(`
    SELECT quantity, entry_price, entry_fees_remaining, unrealized_pnl, executable_bid_vwap, entry_bid_vwap
    FROM copied_positions
    WHERE mode = 'sim' AND status IN ('open', 'closing', 'pending_resolution', 'failed')
  `);
  const closedPnlRes = await client.query(`
    SELECT COALESCE(SUM(realized_pnl), 0) AS s
    FROM copied_positions WHERE mode = 'sim' AND status = 'closed'
  `);

  const storedCash = Number(balanceRes.rows[0]?.amount ?? 0);
  const baselineStored = balanceRes.rows[0]?.baseline_capital;
  const simInitialCapital = Number(riskRes.rows[0]?.sim_initial_capital ?? 50);
  const baselineCapital =
    baselineStored != null && Number(baselineStored) > 0
      ? Number(baselineStored)
      : simInitialCapital;

  const executions: SimExecutionCashRow[] = execRes.rows.map((ex) => ({
    copiedPositionId: ex.copied_position_id,
    side: ex.side as 'BUY' | 'SELL',
    reason: ex.reason,
    fillPrice: Number(ex.fill_price ?? 0),
    fillQuantity: Number(ex.fill_quantity ?? 0),
    fees: Number(ex.fees ?? 0),
  }));

  const netCashDelta = replaySimCashDelta(executions);
  const expectedCash = baselineCapital + netCashDelta;
  const drift = storedCash - expectedCash;

  let positionsValue = 0;
  let openPnlComputed = 0;
  for (const p of openPos.rows) {
    const qty = Number(p.quantity);
    const mark =
      Number(p.executable_bid_vwap) > 0
        ? Number(p.executable_bid_vwap)
        : Number(p.entry_bid_vwap) || Number(p.entry_price);
    positionsValue += qty * mark;
    openPnlComputed +=
      mark * qty -
      Number(p.entry_price) * qty -
      Number(p.entry_fees_remaining ?? 0);
  }

  const closedPnlSum = Number(closedPnlRes.rows[0]?.s ?? 0);
  const equity = storedCash + positionsValue;
  const pnlEquity = baselineCapital + openPnlComputed + closedPnlSum;
  const pnlGap = equity - pnlEquity;

  const hasBaselineColumn = balanceRes.fields.some(
    (f) => f.name === 'baseline_capital',
  );

  console.log('=== Vérification cash simulation (PostgreSQL) ===\n');

  if (!hasBaselineColumn) {
    console.log('⚠ Colonne baseline_capital absente — lancer: npm run migrate -w packages/core\n');
  }

  console.log('Config:');
  console.log(`  sim_initial_capital:     ${simInitialCapital} pUSD`);
  console.log(
    `  baseline_capital (DB):   ${baselineStored ?? '(null)'} → utilisé: ${baselineCapital} pUSD`,
  );
  console.log(`  balance updated_at:      ${balanceRes.rows[0]?.updated_at ?? 'n/a'}`);
  console.log('');
  console.log('Cash vs ledger exécutions:');
  console.log(`  cash stocké:             ${storedCash.toFixed(4)} pUSD`);
  console.log(`  delta net exécutions:    ${netCashDelta.toFixed(4)} pUSD`);
  console.log(`  cash attendu:            ${expectedCash.toFixed(4)} pUSD`);
  console.log(`  écart (drift):           ${drift.toFixed(4)} pUSD`);
  console.log('');
  console.log('Equity / P&L:');
  console.log(`  valeur positions:        ${positionsValue.toFixed(4)} pUSD`);
  console.log(`  equity:                  ${equity.toFixed(4)} pUSD`);
  console.log(`  open P&L (recalculé):    ${openPnlComputed.toFixed(4)} pUSD`);
  console.log(`  closed P&L:              ${closedPnlSum.toFixed(4)} pUSD`);
  console.log(`  baseline + P&L:          ${pnlEquity.toFixed(4)} pUSD`);
  console.log(`  écart equity vs P&L:     ${pnlGap.toFixed(4)} pUSD`);
  console.log('');
  console.log(`  exécutions filled/partial: ${executions.length}`);
  console.log('  répartition exécutions:', execCount.rows);
  console.log('  répartition positions:  ', posCount.rows);

  const cashOk = Math.abs(drift) <= TOLERANCE;
  console.log('');
  if (cashOk) {
    console.log('✓ Cash cohérent avec le ledger (écart ≤ 0,01 pUSD).');
  } else {
    console.log('✗ Cash incohérent — le worker doit lancer ensureCashIntegrity() au démarrage.');
    console.log('  → Redémarrer le worker (npm run dev inclut worker si configuré ainsi).');
  }

  if (Math.abs(pnlGap) > 1) {
    console.log(`  Note: écart equity/P&L ${pnlGap.toFixed(2)} pUSD — souvent lié au mark price vs entry.`);
  }

  await client.end();
  process.exit(cashOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
