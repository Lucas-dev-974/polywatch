import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCopiedPositionClosingReason1700000000048 implements MigrationInterface {
  name = 'AddCopiedPositionClosingReason1700000000048';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE copied_positions
        ADD COLUMN IF NOT EXISTS closing_reason text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE copied_positions
        DROP COLUMN IF EXISTS closing_reason
    `);
  }
}
