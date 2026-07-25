import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisReportsAndRiskConfigRevisions1700000000047
  implements MigrationInterface
{
  name = 'AddAnalysisReportsAndRiskConfigRevisions1700000000047';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_config_revisions (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL DEFAULT 'api',
        patch_json TEXT,
        config_json TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_risk_config_revisions_created
      ON risk_config_revisions (created_at DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analysis_reports (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        label TEXT NOT NULL,
        note TEXT,
        type TEXT NOT NULL,
        params_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        scope_summary TEXT NOT NULL,
        positions_closed_count INTEGER NOT NULL DEFAULT 0,
        positions_total_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_reports_created
      ON analysis_reports (created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_reports_type_created
      ON analysis_reports (type, created_at DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_analysis_reports_type_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_analysis_reports_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS analysis_reports`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_risk_config_revisions_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS risk_config_revisions`);
  }
}
