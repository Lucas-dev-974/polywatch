import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClobHistoryIntervalToUniqueKey1700000000104 implements MigrationInterface {
  name = 'AddClobHistoryIntervalToUniqueKey1700000000104';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'weather_clob_price_history_condition_id_side_recorded_at_key'
        ) THEN
          ALTER TABLE weather_clob_price_history
            DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_key;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key UNIQUE (condition_id, side, recorded_at, fidelity_minutes)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'weather_clob_price_history_condition_id_side_recorded_at_fidelity_key'
        ) THEN
          ALTER TABLE weather_clob_price_history
            DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_key UNIQUE (condition_id, side, recorded_at)`,
    );
  }
}
