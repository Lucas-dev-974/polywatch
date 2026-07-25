import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    // Analyse détaillée des échecs
    console.log('=== ANALYSE DES ÉCHECS D\'EXÉCUTION ===\n');

    // 1. Distribution des tailles d'ordre échouées
    const failedSizesRes = await client.query(`
      SELECT
        MIN(requested_qty) as min_qty,
        MAX(requested_qty) as max_qty,
        AVG(requested_qty) as avg_qty,
        COUNT(*) as total
      FROM executions
      WHERE mode='sim' AND status='failed' AND reason='COPY_OPEN' AND error='below_min_order_size'
    `);
    const failedSizes = failedSizesRes.rows[0];
    console.log(`Ordres COPY_OPEN échoués (below_min_order_size):`);
    console.log(`  Total: ${failedSizes.total}`);
    console.log(`  Quantité min: ${Number(failedSizes.min_qty)?.toFixed(6)}`);
    console.log(`  Quantité max: ${Number(failedSizes.max_qty)?.toFixed(6)}`);
    console.log(`  Quantité avg: ${Number(failedSizes.avg_qty)?.toFixed(6)}`);
    console.log(`  Seuil minimum: 1 share`);

    // 2. Analyse des positions fermées par raison de clôture
    console.log('\n=== PERFORMANCE PAR RAISON DE CLÔTURE ===\n');
    const closeStatsRes = await client.query(`
      SELECT
        close_reason,
        COUNT(*) as n,
        SUM(realized_pnl) as total_pnl,
        AVG(realized_pnl) as avg_pnl,
        SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
        AVG(entry_price) as avg_entry,
        AVG(quantity) as avg_qty,
        AVG(entry_fees) as avg_fees
      FROM copied_positions
      WHERE mode='sim' AND status='closed'
      GROUP BY close_reason
    `);
    for (const row of closeStatsRes.rows) {
      const winRate = ((Number(row.wins) / Number(row.n)) * 100).toFixed(1);
      console.log(`${row.close_reason}:`);
      console.log(`  Positions: ${row.n}`);
      console.log(`  Win rate: ${winRate}%`);
      console.log(`  Total PnL: ${Number(row.total_pnl)?.toFixed(4)} USDC`);
      console.log(`  Avg PnL: ${Number(row.avg_pnl)?.toFixed(4)} USDC`);
      console.log(`  Avg entry price: ${Number(row.avg_entry)?.toFixed(4)}`);
      console.log(`  Avg quantity: ${Number(row.avg_qty)?.toFixed(4)}`);
      console.log('');
    }

    // 3. Analyse des rédemptions (marchés résolus)
    console.log('=== ANALYSE DES RÉDEMPTIONS (MARCHÉS RÉSOLUS) ===\n');
    const redemptionsRes = await client.query(`
      SELECT
        p.id,
        p.realized_pnl,
        p.quantity,
        p.entry_price,
        m.question,
        m.winning_token_id,
        p.outcome
      FROM copied_positions p
      LEFT JOIN markets m ON p.condition_id = m.condition_id
      WHERE p.mode='sim' AND p.close_reason='REDEMPTION'
      ORDER BY p.realized_pnl DESC
      LIMIT 15
    `);
    for (const r of redemptionsRes.rows) {
      console.log(`[${r.id}] PnL: ${Number(r.realized_pnl)?.toFixed(4)} | ${r.outcome} | ${r.question?.slice(0, 60)}`);
    }
    console.log('\n...');

    // 4. Liquidité des marchés copy-tradés
    console.log('\n=== MARCHÉS COPY-TRADÉS ===\n');
    const marketsRes = await client.query(`
      SELECT
        m.question,
        m.category,
        COUNT(DISTINCT p.id) as pos_count,
        SUM(CASE WHEN p.status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN p.status='closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN e.status='failed' THEN 1 ELSE 0 END) as failed_execs,
        SUM(CASE WHEN e.status='filled' THEN 1 ELSE 0 END) as filled_execs
      FROM copied_positions p
      JOIN markets m ON p.condition_id = m.condition_id
      LEFT JOIN executions e ON e.copied_position_id = p.id
      WHERE p.mode = 'sim'
      GROUP BY m.condition_id
      ORDER BY pos_count DESC
      LIMIT 10
    `);
    for (const m of marketsRes.rows) {
      console.log(`${m.question?.slice(0, 50)}:`);
      console.log(`  Positions: ${m.pos_count} (cancelled: ${m.cancelled}, closed: ${m.closed})`);
      console.log(`  Execs: ${m.filled_execs} filled, ${m.failed_execs} failed`);
      console.log(`  Catégorie: ${m.category}`);
      console.log('');
    }

    // 5. Distribution des PnL
    console.log('=== DISTRIBUTION DES PNL (POSITIONS FERMÉES) ===\n');
    const pnlBinsRes = await client.query(`
      SELECT
        CASE
          WHEN realized_pnl < -1 THEN '<-1'
          WHEN realized_pnl < -0.5 THEN '-1 to -0.5'
          WHEN realized_pnl < 0 THEN '-0.5 to 0'
          WHEN realized_pnl < 0.5 THEN '0 to 0.5'
          WHEN realized_pnl < 1 THEN '0.5 to 1'
          ELSE '>1'
        END as bin,
        COUNT(*) as cnt
      FROM copied_positions
      WHERE mode='sim' AND status='closed'
      GROUP BY bin
      ORDER BY
        CASE bin
          WHEN '<-1' THEN 1
          WHEN '-1 to -0.5' THEN 2
          WHEN '-0.5 to 0' THEN 3
          WHEN '0 to 0.5' THEN 4
          WHEN '0.5 to 1' THEN 5
          ELSE 6
        END
    `);
    for (const b of pnlBinsRes.rows) {
      console.log(`${b.bin}: ${b.cnt} positions`);
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