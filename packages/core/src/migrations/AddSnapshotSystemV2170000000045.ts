import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSnapshotSystemV2170000000045 implements MigrationInterface {
  name = 'AddSnapshotSystemV2170000000045';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE simulation_balances
        ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMP
    `);
    await queryRunner.query(`
      UPDATE simulation_balances
      SET session_started_at = COALESCE(session_started_at, updated_at, CURRENT_TIMESTAMP)
      WHERE session_started_at IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE exit_attempt_events
        ADD COLUMN IF NOT EXISTS mode text
    `);
    await queryRunner.query(`
      UPDATE exit_attempt_events e
      SET mode = p.mode
      FROM copied_positions p
      WHERE e.copied_position_id = p.id AND e.mode IS NULL
    `);
    await queryRunner.query(`
      UPDATE exit_attempt_events e
      SET mode = ex.mode
      FROM executions ex
      WHERE e.execution_id = ex.id AND e.mode IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_exit_attempt_events_mode_created
      ON exit_attempt_events (mode, created_at)
    `);

    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        ADD COLUMN IF NOT EXISTS exit_attempts_json text
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        ADD COLUMN IF NOT EXISTS move_events_json text
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        ADD COLUMN IF NOT EXISTS decision_summary_json text
    `);

    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_auto_snapshot_empty_session boolean DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_snapshot_decision_window_hours integer DEFAULT 24
    `);

    await queryRunner.query(`
      ALTER TABLE algo_surveillance_snapshots
        ADD COLUMN IF NOT EXISTS positions_json text
    `);
    await queryRunner.query(`
      ALTER TABLE algo_surveillance_snapshots
        ADD COLUMN IF NOT EXISTS positions_captured_at TIMESTAMP
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE algo_surveillance_snapshots
        DROP COLUMN IF EXISTS positions_captured_at
    `);
    await queryRunner.query(`
      ALTER TABLE algo_surveillance_snapshots
        DROP COLUMN IF EXISTS positions_json
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS sim_snapshot_decision_window_hours
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS sim_auto_snapshot_empty_session
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        DROP COLUMN IF EXISTS decision_summary_json
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        DROP COLUMN IF EXISTS move_events_json
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        DROP COLUMN IF EXISTS exit_attempts_json
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS IDX_exit_attempt_events_mode_created
    `);
    await queryRunner.query(`
      ALTER TABLE exit_attempt_events
        DROP COLUMN IF EXISTS mode
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_balances
        DROP COLUMN IF EXISTS session_started_at
    `);
  }
}
