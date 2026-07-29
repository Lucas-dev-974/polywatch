import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacyRiskConfig1700000000088 implements MigrationInterface {
  name = 'DropLegacyRiskConfig1700000000088';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS risk_config CASCADE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate an empty risk_config table in case of rollback
    await queryRunner.query(`
      CREATE TABLE risk_config (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY
      )
    `);
  }
}
