import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimRealismConfig1700000000043 implements MigrationInterface {
  name = 'AddSimRealismConfig1700000000043';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_exec_latency_mode text
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_exec_latency_ms integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_self_impact_enabled boolean
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_self_impact_ttl_seconds integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_wallet_preflight_enabled boolean
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS sim_shadow_logging_enabled boolean
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS shadow_sample_retention_days integer
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS clob_latency_samples (
        id SERIAL NOT NULL,
        signal_id text NOT NULL,
        rtt_ms integer NOT NULL,
        side text NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_clob_latency_samples PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_clob_latency_samples_created_at
      ON clob_latency_samples (created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS shadow_fills (
        id SERIAL NOT NULL,
        signal_id text NOT NULL,
        asset_id text NOT NULL,
        side text NOT NULL,
        limit_price real NOT NULL,
        real_fill_price real NOT NULL,
        real_fill_qty real NOT NULL,
        sim_fill_price real NOT NULL,
        sim_fill_qty real NOT NULL,
        price_delta_pct real NOT NULL,
        qty_delta_pct real NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT PK_shadow_fills PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_shadow_fills_created_at
      ON shadow_fills (created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_shadow_fills_created_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS shadow_fills`);
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_clob_latency_samples_created_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS clob_latency_samples`);

    const columns = [
      'shadow_sample_retention_days',
      'sim_shadow_logging_enabled',
      'sim_wallet_preflight_enabled',
      'sim_self_impact_ttl_seconds',
      'sim_self_impact_enabled',
      'sim_exec_latency_ms',
      'sim_exec_latency_mode',
    ];
    for (const col of columns) {
      await queryRunner.query(`
        ALTER TABLE risk_config DROP COLUMN IF EXISTS ${col}
      `);
    }
  }
}
