import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0087 intended to DROP NOT NULL on config_fingerprint, but some
 * databases still have the column as NOT NULL while weather/global/copy
 * revisions correctly insert NULL → 500 on PUT /api/config/weather.
 */
export class EnsureRiskConfigFingerprintNullable1700000000090
  implements MigrationInterface
{
  name = 'EnsureRiskConfigFingerprintNullable1700000000090';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config_revisions
      ALTER COLUMN config_fingerprint DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE risk_config_revisions
      SET config_fingerprint = ''
      WHERE config_fingerprint IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config_revisions
      ALTER COLUMN config_fingerprint SET NOT NULL
    `);
  }
}
