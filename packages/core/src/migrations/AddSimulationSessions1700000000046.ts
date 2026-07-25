import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimulationSessions1700000000046 implements MigrationInterface {
  name = 'AddSimulationSessions1700000000046';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS simulation_sessions (
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
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_simulation_sessions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_sessions_status_started
      ON simulation_sessions (status, started_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_sessions_started
      ON simulation_sessions (started_at)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_sessions_one_active
      ON simulation_sessions (status)
      WHERE status = 'active'
    `);

    await queryRunner.query(`
      ALTER TABLE simulation_balances
        ADD COLUMN IF NOT EXISTS current_session_id integer
    `);

    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        ADD COLUMN IF NOT EXISTS session_id integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_snapshots_session_created
      ON simulation_state_snapshots (session_id, created_at)
    `);

    // Bootstrap: one closed legacy session for orphan snapshots, then one active session.
    await queryRunner.query(`
      INSERT INTO simulation_sessions (
        started_at, ended_at, status, label, baseline_capital,
        ending_equity, ending_session_pnl, snapshot_count, peak_equity, trough_equity
      )
      SELECT
        COALESCE(MIN(s.created_at), COALESCE(b.session_started_at, b.updated_at, CURRENT_TIMESTAMP)),
        CASE
          WHEN COUNT(s.id) FILTER (WHERE s.source = 'reset') > 0
            THEN MAX(s.created_at) FILTER (WHERE s.source = 'reset')
          WHEN COUNT(s.id) > 0 THEN MAX(s.created_at)
          ELSE NULL
        END,
        'closed',
        'Legacy (avant sessions)',
        COALESCE(MAX(s.baseline_capital), b.baseline_capital, b.amount, 1000),
        MAX(s.equity),
        MAX(s.equity) - COALESCE(MAX(s.baseline_capital), b.baseline_capital, b.amount, 1000),
        COUNT(s.id)::int,
        MAX(s.equity),
        MIN(s.equity)
      FROM simulation_balances b
      LEFT JOIN simulation_state_snapshots s ON true
      GROUP BY b.id, b.session_started_at, b.updated_at, b.baseline_capital, b.amount
      HAVING COUNT(s.id) > 0
    `);

    await queryRunner.query(`
      UPDATE simulation_state_snapshots snap
      SET session_id = (
        SELECT ss.id FROM simulation_sessions ss
        WHERE ss.label = 'Legacy (avant sessions)'
        ORDER BY ss.id ASC
        LIMIT 1
      )
      WHERE snap.session_id IS NULL
        AND EXISTS (
          SELECT 1 FROM simulation_sessions ss
          WHERE ss.label = 'Legacy (avant sessions)'
        )
    `);

    await queryRunner.query(`
      INSERT INTO simulation_sessions (
        started_at, status, label, baseline_capital, snapshot_count
      )
      SELECT
        COALESCE(b.session_started_at, b.updated_at, CURRENT_TIMESTAMP),
        'active',
        NULL,
        COALESCE(b.baseline_capital, b.amount, 1000),
        0
      FROM simulation_balances b
      WHERE NOT EXISTS (
        SELECT 1 FROM simulation_sessions s WHERE s.status = 'active'
      )
    `);

    await queryRunner.query(`
      UPDATE simulation_balances b
      SET current_session_id = (
        SELECT s.id FROM simulation_sessions s
        WHERE s.status = 'active'
        ORDER BY s.id DESC
        LIMIT 1
      )
      WHERE b.current_session_id IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_sim_snapshots_session_created
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_state_snapshots
        DROP COLUMN IF EXISTS session_id
    `);
    await queryRunner.query(`
      ALTER TABLE simulation_balances
        DROP COLUMN IF EXISTS current_session_id
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_sim_sessions_one_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_sessions_started`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_sessions_status_started`);
    await queryRunner.query(`DROP TABLE IF EXISTS simulation_sessions`);
  }
}
