import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimBalancePerAlgoKind1700000000084 implements MigrationInterface {
  name = 'SimBalancePerAlgoKind1700000000084';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add algo_kind column
    await queryRunner.query(
      `ALTER TABLE simulation_balances ADD COLUMN algo_kind TEXT DEFAULT 'crypto'`,
    );

    // 2. Create unique index on algo_kind
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_sim_balances_algo_kind ON simulation_balances(algo_kind)`,
    );

    // 3. Clean slate: delete all existing sim positions, executions, reservations
    await queryRunner.query(
      `DELETE FROM position_reservations WHERE mode = 'sim'`,
    );
    await queryRunner.query(
      `DELETE FROM executions WHERE mode = 'sim'`,
    );
    await queryRunner.query(
      `DELETE FROM copied_positions WHERE mode = 'sim'`,
    );

    // 4. Mark unprocessed move events as processed (stale pre-reset events)
    await queryRunner.query(
      `UPDATE move_events SET processed = true WHERE processed = false`,
    );

    // 5. Delete the old single global balance row
    await queryRunner.query(`DELETE FROM simulation_balances`);

    // 6. Create 3 lines: crypto, weather, copy — each with simInitialCapital
    //    We read simInitialCapital from risk_config (fallback 1000)
    const riskRow = await queryRunner.query(
      `SELECT sim_initial_capital FROM risk_config LIMIT 1`,
    );
    const simInitialCapital =
      riskRow.length > 0 && riskRow[0].sim_initial_capital != null
        ? Number(riskRow[0].sim_initial_capital)
        : 1000;

    const now = new Date().toISOString();
    for (const algoKind of ['crypto', 'weather', 'copy']) {
      await queryRunner.query(
        `INSERT INTO simulation_balances (algo_kind, token, amount, baseline_capital, session_started_at)
         VALUES ($1, 'pUSD', $2, $2, $3)`,
        [algoKind, simInitialCapital, now],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_balances_algo_kind`);
    await queryRunner.query(
      `ALTER TABLE simulation_balances DROP COLUMN IF EXISTS algo_kind`,
    );
  }
}
