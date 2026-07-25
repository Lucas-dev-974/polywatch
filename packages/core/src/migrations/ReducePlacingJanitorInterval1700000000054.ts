import { MigrationInterface, QueryRunner } from 'typeorm';

/** Faster orphan `placing` cleanup (60s → 15s). */
export class ReducePlacingJanitorInterval1700000000054 implements MigrationInterface {
  name = 'ReducePlacingJanitorInterval1700000000054';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "system_config"
      SET "value" = '15000'
      WHERE "key" = 'worker.placing_janitor.loop_ms'
        AND "value" = '60000'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "system_config"
      SET "value" = '60000'
      WHERE "key" = 'worker.placing_janitor.loop_ms'
        AND "value" = '15000'
    `);
  }
}
