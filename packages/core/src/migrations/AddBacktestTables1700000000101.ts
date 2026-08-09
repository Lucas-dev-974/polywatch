import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestTables1700000000101 implements MigrationInterface {
  name = 'AddBacktestTables1700000000101';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE backtest_runs (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        status TEXT NOT NULL,
        progress_pct INTEGER NOT NULL DEFAULT 0,
        domain TEXT NOT NULL,
        mode TEXT NOT NULL,
        label TEXT,
        params_json TEXT NOT NULL,
        config_snapshot_json TEXT,
        data_range_from TIMESTAMP,
        data_range_to TIMESTAMP,
        stats_json TEXT,
        fidelity_warnings_json TEXT,
        engine_version TEXT,
        config_fingerprint TEXT,
        error TEXT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_btr_domain_created ON backtest_runs (domain, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_btr_status ON backtest_runs (status)`,
    );

    await queryRunner.query(`
      CREATE TABLE backtest_positions (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
        condition_id TEXT NOT NULL,
        city TEXT,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL,
        entry_at TIMESTAMP NOT NULL,
        exit_at TIMESTAMP,
        entry_reason TEXT,
        exit_reason TEXT,
        pnl REAL,
        fees REAL NOT NULL DEFAULT 0,
        meta_json TEXT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_btp_run_id ON backtest_positions (run_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_btp_run_exit ON backtest_positions (run_id, exit_reason)`,
    );

    await queryRunner.query(`
      CREATE TABLE backtest_equity_points (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
        t TIMESTAMP NOT NULL,
        equity REAL NOT NULL,
        cash REAL NOT NULL,
        open_positions INTEGER NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_bte_run_id ON backtest_equity_points (run_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS backtest_equity_points CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS backtest_positions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS backtest_runs CASCADE`);
  }
}
