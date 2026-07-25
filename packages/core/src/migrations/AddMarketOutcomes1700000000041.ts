import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketOutcomes1700000000041 implements MigrationInterface {
  name = 'AddMarketOutcomes1700000000041';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE markets ADD COLUMN outcomes text NOT NULL DEFAULT '[]';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE markets DROP COLUMN outcomes;
    `);
  }
}
