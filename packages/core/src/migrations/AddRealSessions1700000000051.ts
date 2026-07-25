import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRealSessions1700000000051 implements MigrationInterface {
  name = 'AddRealSessions1700000000051';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_sessions (
        id SERIAL NOT NULL,
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP,
        status text NOT NULL DEFAULT 'active',
        label text,
        notes text,
        baseline_capital real NOT NULL,
        ending_equity real,
        ending_session_pnl real,
        snapshot_count integer NOT NULL DEFAULT 0,
        peak_equity real,
        trough_equity real,
        archive_summary_json text,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_real_sessions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_sessions_status_started
      ON real_sessions (status, started_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_sessions_started
      ON real_sessions (started_at)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_real_sessions_one_active
      ON real_sessions (status)
      WHERE status = 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_session_state (
        id integer NOT NULL DEFAULT 1,
        current_session_id integer,
        period_started_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_real_session_state PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_state_snapshots (
        id SERIAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        label text,
        source text NOT NULL,
        session_id integer,
        amount real NOT NULL,
        token text NOT NULL DEFAULT 'USDC',
        positions_value real NOT NULL,
        equity real NOT NULL,
        open_pnl_sum real NOT NULL,
        closed_pnl_sum real NOT NULL,
        baseline_capital real NOT NULL,
        position_count integer NOT NULL,
        open_position_count integer NOT NULL,
        closed_position_count integer NOT NULL,
        execution_count integer NOT NULL,
        trader_count integer NOT NULL,
        traders_label text NOT NULL,
        config_json text NOT NULL,
        traders_json text NOT NULL,
        positions_json text NOT NULL,
        executions_json text NOT NULL,
        exit_attempts_json text,
        move_events_json text,
        decision_summary_json text,
        CONSTRAINT PK_real_state_snapshots PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_snapshots_source_created
      ON real_state_snapshots (source, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_snapshots_created
      ON real_state_snapshots (created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_snapshots_session_created
      ON real_state_snapshots (session_id, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_archive_positions (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        condition_id text NOT NULL,
        asset_id text NOT NULL,
        market_title text,
        outcome text NOT NULL,
        side text NOT NULL,
        size real NOT NULL,
        entry_price real NOT NULL,
        exit_price real,
        realized_pnl real NOT NULL DEFAULT 0,
        close_reason text,
        reason text,
        opened_at TIMESTAMP,
        closed_at TIMESTAMP,
        raw_json text NOT NULL,
        CONSTRAINT PK_real_archive_positions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_archive_positions_session
      ON real_archive_positions (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_archive_executions (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        copied_position_id integer NOT NULL,
        side text NOT NULL,
        fill_price real,
        fill_quantity real,
        fees real NOT NULL DEFAULT 0,
        realized_pnl real NOT NULL DEFAULT 0,
        status text NOT NULL,
        reason text,
        executed_at TIMESTAMP,
        raw_json text NOT NULL,
        CONSTRAINT PK_real_archive_executions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_archive_executions_session
      ON real_archive_executions (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS real_archive_exit_attempts (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        copied_position_id integer NOT NULL,
        kind text NOT NULL,
        close_reason text NOT NULL,
        block_reason text,
        error text,
        mark_bid real,
        created_at TIMESTAMP NOT NULL,
        raw_json text NOT NULL,
        CONSTRAINT PK_real_archive_exit_attempts PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_real_archive_exit_attempts_session
      ON real_archive_exit_attempts (session_id)
    `);

    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS real_auto_snapshot_enabled boolean DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS real_auto_snapshot_interval_seconds integer DEFAULT 3600
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS real_snapshot_max_count integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS real_snapshot_retention_days integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS real_snapshot_decision_window_hours integer DEFAULT 24
    `);

    // Bootstrap: legacy closed session if closed real positions exist before now.
    await queryRunner.query(`
      INSERT INTO real_sessions (
        started_at, ended_at, status, label, baseline_capital,
        ending_equity, ending_session_pnl, snapshot_count
      )
      SELECT
        COALESCE(MIN(cp.closed_at), CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP,
        'closed',
        'Legacy (avant périodes)',
        0,
        0,
        0,
        0
      FROM copied_positions cp
      WHERE cp.mode = 'real'
        AND cp.status = 'closed'
        AND cp.closed_at IS NOT NULL
        AND cp.closed_at < CURRENT_TIMESTAMP
      HAVING COUNT(cp.id) > 0
    `);

    // Active session for the current period.
    await queryRunner.query(`
      INSERT INTO real_sessions (
        started_at, status, baseline_capital, snapshot_count
      )
      SELECT CURRENT_TIMESTAMP, 'active', 0, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM real_sessions s WHERE s.status = 'active'
      )
    `);

    await queryRunner.query(`
      INSERT INTO real_session_state (id, current_session_id, period_started_at)
      SELECT
        1,
        (SELECT s.id FROM real_sessions s WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 1),
        (SELECT s.started_at FROM real_sessions s WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 1)
      WHERE NOT EXISTS (SELECT 1 FROM real_session_state)
    `);

    await queryRunner.query(`
      UPDATE real_session_state rs
      SET current_session_id = (
        SELECT s.id FROM real_sessions s WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 1
      ),
      period_started_at = COALESCE(
        rs.period_started_at,
        (SELECT s.started_at FROM real_sessions s WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 1)
      )
      WHERE rs.current_session_id IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS real_snapshot_decision_window_hours
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS real_snapshot_retention_days
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS real_snapshot_max_count
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS real_auto_snapshot_interval_seconds
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS real_auto_snapshot_enabled
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_archive_exit_attempts_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS real_archive_exit_attempts`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_archive_executions_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS real_archive_executions`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_archive_positions_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS real_archive_positions`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_snapshots_session_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_snapshots_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_snapshots_source_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS real_state_snapshots`);

    await queryRunner.query(`DROP TABLE IF EXISTS real_session_state`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_real_sessions_one_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_sessions_started`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_real_sessions_status_started`);
    await queryRunner.query(`DROP TABLE IF EXISTS real_sessions`);
  }
}
