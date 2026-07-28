import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
import {
  replaySimCashDelta,
  type SimExecutionCashRow,
} from '../packages/core/dist/simulation/accounting.js';
import { algoKindFromReason } from '../packages/core/dist/simulation/algo-kind.js';

loadMonorepoEnv();

const TOLERANCE = 0.01;
const ALGO_KINDS = ['crypto', 'weather', 'copy'] as const;

async function verifyAlgo(
  client: pg.Client,
  algoKind: (typeof ALGO_KINDS)[number],
): Promise<boolean> {
  const balanceRes = await client.query(
    `SELECT amount, baseline_capital, token, updated_at
     FROM simulation_balances WHERE algo_kind = $1 LIMIT 1`,
    [algoKind],
  );
  const capitalCol =
    algoKind === 'weather'
      ? 'sim_initial_capital_weather'
      : algoKind === 'copy'
        ? 'sim_initial_capital_copy'
        : 'sim_initial_capital_crypto';
  const riskRes = await client.query(
    `SELECT ${capitalCol} AS cap FROM risk_config LIMIT 1`,
  );

  const execRes = await client.query(`
    SELECT e.copied_position_id, e.side, e.reason, e.fill_price, e.fill_quantity, e.fees, e.status,
           p.reason AS pos_reason
    FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE e.mode = 'sim' AND e.status IN ('filled', 'partial')
    ORDER BY COALESCE(e.executed_at, '1970-01-01'), e.id
  `);

  const executions: SimExecutionCashRow[] = execRes.rows
    .filter((ex) => algoKindFromReason(ex.pos_reason) === algoKind)
    .map((ex) => ({
      copiedPositionId: ex.copied_position_id,
      side: ex.side as 'BUY' | 'SELL',
      reason: ex.reason,
      fillPrice: Number(ex.fill_price ?? 0),
      fillQuantity: Number(ex.fill_quantity ?? 0),
      fees: Number(ex.fees ?? 0),
    }));

  const storedCash = Number(balanceRes.rows[0]?.amount ?? 0);
  const baselineStored = balanceRes.rows[0]?.baseline_capital;
  const simInitialCapital = Number(riskRes.rows[0]?.cap ?? 50);
  const baselineCapital =
    baselineStored != null && Number(baselineStored) > 0
      ? Number(baselineStored)
      : simInitialCapital;

  const netCashDelta = replaySimCashDelta(executions);
  const expectedCash = baselineCapital + netCashDelta;
  const drift = storedCash - expectedCash;
  const cashOk = Math.abs(drift) <= TOLERANCE;

  console.log(`=== ${algoKind.toUpperCase()} ===`);
  console.log(`  cash stocké:    ${storedCash.toFixed(4)} pUSD`);
  console.log(`  cash attendu:   ${expectedCash.toFixed(4)} pUSD`);
  console.log(`  drift:          ${drift.toFixed(4)} pUSD`);
  console.log(cashOk ? '  ✓ OK' : '  ✗ INCOHÉRENT');
  console.log('');

  return cashOk;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('=== Vérification cash simulation par algoKind ===\n');

  let allOk = true;
  for (const algoKind of ALGO_KINDS) {
    allOk = (await verifyAlgo(client, algoKind)) && allOk;
  }

  await client.end();
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
