import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimInitialCapitalPerAlgoKind1700000000086 implements MigrationInterface {
  name = 'AddSimInitialCapitalPerAlgoKind1700000000086';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE risk_config
       ADD COLUMN IF NOT EXISTS sim_initial_capital_crypto REAL NOT NULL DEFAULT 10000`,
    );
    await queryRunner.query(
      `ALTER TABLE risk_config
       ADD COLUMN IF NOT EXISTS sim_initial_capital_weather REAL NOT NULL DEFAULT 10000`,
    );
    await queryRunner.query(
      `ALTER TABLE risk_config
       ADD COLUMN IF NOT EXISTS sim_initial_capital_copy REAL NOT NULL DEFAULT 10000`,
    );

    await queryRunner.query(
      `UPDATE risk_config SET
         sim_initial_capital_crypto = COALESCE(sim_initial_capital, 10000),
         sim_initial_capital_weather = COALESCE(sim_initial_capital, 10000),
         sim_initial_capital_copy = COALESCE(sim_initial_capital, 10000)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE risk_config DROP COLUMN IF EXISTS sim_initial_capital_copy`,
    );
    await queryRunner.query(
      `ALTER TABLE risk_config DROP COLUMN IF EXISTS sim_initial_capital_weather`,
    );
    await queryRunner.query(
      `ALTER TABLE risk_config DROP COLUMN IF EXISTS sim_initial_capital_crypto`,
    );
  }
}
