import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRealCashOverride1700000000007 implements MigrationInterface {
  name = 'AddRealCashOverride1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE risk_config ADD COLUMN real_cash_override REAL DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE risk_config DROP COLUMN real_cash_override`,
    );
  }
}