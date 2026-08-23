import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestRunUserIdAndActiveUnique1700000000119
  implements MigrationInterface
{
  name = 'AddBacktestRunUserIdAndActiveUnique1700000000119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE backtest_runs ADD COLUMN user_id INTEGER`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_btr_user_id ON backtest_runs (user_id)`,
    );
    // Lock singleton par utilisateur : un seul run actif (running/queued) par
    // (domain, user_id). PostgreSQL traite les NULL comme distincts dans un
    // index unique, donc les runs hérités (user_id IS NULL) ne se
    // collisionnent pas entre eux — comportement rétro-compatible.
    await queryRunner.query(`
      CREATE UNIQUE INDEX backtest_run_active_unique
        ON backtest_runs (domain, user_id)
        WHERE status IN ('running', 'queued')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS backtest_run_active_unique`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_btr_user_id`);
    await queryRunner.query(`ALTER TABLE backtest_runs DROP COLUMN IF EXISTS user_id`);
  }
}
