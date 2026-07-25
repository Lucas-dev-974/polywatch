import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds indexes on simulation_state_snapshots for the two hot query patterns:
 * 1. lastAutoSnapshotAgeSeconds: WHERE source='auto' ORDER BY created_at DESC LIMIT 1
 * 2. listSnapshots: ORDER BY created_at DESC with optional source filter
 */
export class AddSnapshotIndexes1700000000001 implements MigrationInterface {
  name = 'AddSnapshotIndexes1700000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_sim_snapshots_source_created"
      ON "simulation_state_snapshots" ("source", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_sim_snapshots_created"
      ON "simulation_state_snapshots" ("created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_sim_snapshots_source_created"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_sim_snapshots_created"
    `);
  }
}
