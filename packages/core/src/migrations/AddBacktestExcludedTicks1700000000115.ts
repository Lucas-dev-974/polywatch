import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestExcludedTicks1700000000115
  implements MigrationInterface
{
  name = 'AddBacktestExcludedTicks1700000000115';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE backtest_excluded_ticks (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
        t TIMESTAMP NOT NULL,
        reason TEXT NOT NULL,
        city TEXT,
        condition_id TEXT NOT NULL,
        metric TEXT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_bet_run_id ON backtest_excluded_ticks (run_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS backtest_excluded_ticks CASCADE`);
  }
}
