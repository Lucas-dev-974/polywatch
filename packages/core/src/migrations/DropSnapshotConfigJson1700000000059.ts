import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSnapshotConfigJson1700000000059 implements MigrationInterface {
  name = 'DropSnapshotConfigJson1700000000059';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        DROP COLUMN IF EXISTS config_json
    `);
    await queryRunner.query(`
      ALTER TABLE real_state_snapshots
        DROP COLUMN IF EXISTS config_json
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        ADD COLUMN IF NOT EXISTS config_json text NOT NULL DEFAULT '{}'
    `);
    await queryRunner.query(`
      ALTER TABLE real_state_snapshots
        ADD COLUMN IF NOT EXISTS config_json text NOT NULL DEFAULT '{}'
    `);
  }
}
