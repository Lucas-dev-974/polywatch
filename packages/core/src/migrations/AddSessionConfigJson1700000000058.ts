import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionConfigJson1700000000058 implements MigrationInterface {
  name = 'AddSessionConfigJson1700000000058';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add config_json to simulation_sessions
    await queryRunner.query(`
      ALTER TABLE simulation_sessions
        ADD COLUMN IF NOT EXISTS config_json text
    `);

    // Add config_json to real_sessions
    await queryRunner.query(`
      ALTER TABLE real_sessions
        ADD COLUMN IF NOT EXISTS config_json text
    `);

    // Backfill sim sessions: copy config_json from the latest snapshot per session
    await queryRunner.query(`
      UPDATE simulation_sessions s
      SET config_json = sub.config_json
      FROM (
        SELECT DISTINCT ON (sn.session_id)
          sn.session_id,
          sn.config_json
        FROM simulation_state_snapshots sn
        WHERE sn.session_id IS NOT NULL
        ORDER BY sn.session_id, sn.created_at DESC, sn.id DESC
      ) sub
      WHERE s.id = sub.session_id
    `);

    // Backfill real sessions: copy config_json from the latest snapshot per session
    await queryRunner.query(`
      UPDATE real_sessions s
      SET config_json = sub.config_json
      FROM (
        SELECT DISTINCT ON (sn.session_id)
          sn.session_id,
          sn.config_json
        FROM real_state_snapshots sn
        WHERE sn.session_id IS NOT NULL
        ORDER BY sn.session_id, sn.created_at DESC, sn.id DESC
      ) sub
      WHERE s.id = sub.session_id
    `);

    // For active sim sessions still null, stamp from live risk_config
    // (handled by application code on next ensureActiveSession / stamp)
    // For orphaned closed sessions still null, set empty object
    await queryRunner.query(`
      UPDATE simulation_sessions
      SET config_json = '{}'
      WHERE config_json IS NULL
    `);
    await queryRunner.query(`
      UPDATE real_sessions
      SET config_json = '{}'
      WHERE config_json IS NULL
    `);

    // Make NOT NULL after backfill
    await queryRunner.query(`
      ALTER TABLE simulation_sessions
        ALTER COLUMN config_json SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE real_sessions
        ALTER COLUMN config_json SET NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE simulation_sessions
        DROP COLUMN IF EXISTS config_json
    `);
    await queryRunner.query(`
      ALTER TABLE real_sessions
        DROP COLUMN IF EXISTS config_json
    `);
  }
}
