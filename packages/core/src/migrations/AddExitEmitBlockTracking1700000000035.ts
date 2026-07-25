import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExitEmitBlockTracking1700000000035
  implements MigrationInterface
{
  name = 'AddExitEmitBlockTracking1700000000035';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_exit_block_reason" text
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_exit_block_close_reason" text
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "first_exit_block_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_exit_block_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "exit_emit_blocked_count" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "exit_emit_blocked_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "last_exit_block_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "first_exit_block_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "last_exit_block_close_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "last_exit_block_reason"
    `);
  }
}
