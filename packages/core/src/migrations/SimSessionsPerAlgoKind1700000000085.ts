import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimSessionsPerAlgoKind1700000000085 implements MigrationInterface {
  name = 'SimSessionsPerAlgoKind1700000000085';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add algo_kind to simulation_sessions
    await queryRunner.query(
      `ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS algo_kind TEXT NOT NULL DEFAULT 'crypto'`,
    );

    // 2. Drop old global unique active index
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_sim_sessions_one_active`,
    );

    // 3. One active session per algoKind
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_sessions_one_active_per_algo
       ON simulation_sessions(algo_kind) WHERE status = 'active'`,
    );

    // 4. Index for list queries
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sim_sessions_algo_status_started
       ON simulation_sessions(algo_kind, status, started_at)`,
    );

    // 5. Backfill existing sessions to crypto
    await queryRunner.query(
      `UPDATE simulation_sessions SET algo_kind = 'crypto' WHERE algo_kind IS NULL OR algo_kind = ''`,
    );

    // 6. Add algo_kind to simulation_state_snapshots (R2)
    await queryRunner.query(
      `ALTER TABLE simulation_state_snapshots ADD COLUMN IF NOT EXISTS algo_kind TEXT`,
    );

    await queryRunner.query(
      `UPDATE simulation_state_snapshots s
       SET algo_kind = COALESCE(
         (SELECT ss.algo_kind FROM simulation_sessions ss WHERE ss.id = s.session_id),
         'crypto'
       )
       WHERE s.algo_kind IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sim_snapshots_algo_source_created
       ON simulation_state_snapshots(algo_kind, source, created_at)`,
    );

    // 7. Ensure active sessions for weather/copy + link balances
    for (const algoKind of ['weather', 'copy']) {
      const activeRows = await queryRunner.query(
        `SELECT id FROM simulation_sessions WHERE status = 'active' AND algo_kind = $1 LIMIT 1`,
        [algoKind],
      );
      if (activeRows.length > 0) continue;

      const balanceRows = await queryRunner.query(
        `SELECT id, baseline_capital, session_started_at, amount
         FROM simulation_balances WHERE algo_kind = $1 LIMIT 1`,
        [algoKind],
      );
      if (balanceRows.length === 0) continue;

      const balance = balanceRows[0];
      const baseline =
        balance.baseline_capital != null
          ? Number(balance.baseline_capital)
          : Number(balance.amount ?? 1000);
      const startedAt =
        balance.session_started_at != null
          ? balance.session_started_at
          : new Date().toISOString();

      const inserted = await queryRunner.query(
        `INSERT INTO simulation_sessions (
           started_at, status, baseline_capital, snapshot_count, config_json, algo_kind
         ) VALUES ($1, 'active', $2, 0, '{}', $3)
         RETURNING id`,
        [startedAt, baseline, algoKind],
      );
      const sessionId = inserted[0]?.id;
      if (sessionId != null) {
        await queryRunner.query(
          `UPDATE simulation_balances
           SET current_session_id = $1, session_started_at = $2
           WHERE algo_kind = $3`,
          [sessionId, startedAt, algoKind],
        );
      }
    }

    // Link crypto balance to its active session if missing
    await queryRunner.query(
      `UPDATE simulation_balances b
       SET current_session_id = s.id
       FROM simulation_sessions s
       WHERE b.algo_kind = 'crypto'
         AND s.status = 'active'
         AND s.algo_kind = 'crypto'
         AND b.current_session_id IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_sim_snapshots_algo_source_created`,
    );
    await queryRunner.query(
      `ALTER TABLE simulation_state_snapshots DROP COLUMN IF EXISTS algo_kind`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_sim_sessions_algo_status_started`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_sim_sessions_one_active_per_algo`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_sessions_one_active
       ON simulation_sessions(status) WHERE status = 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE simulation_sessions DROP COLUMN IF EXISTS algo_kind`,
    );
  }
}
