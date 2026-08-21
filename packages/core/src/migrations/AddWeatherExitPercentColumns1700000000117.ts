import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherExitPercentColumns1700000000117
  implements MigrationInterface
{
  name = 'AddWeatherExitPercentColumns1700000000117';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE copied_positions ADD COLUMN IF NOT EXISTS sl_percent REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions ADD COLUMN IF NOT EXISTS tp_percent REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions ADD COLUMN IF NOT EXISTS trailing_percent REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions ADD COLUMN IF NOT EXISTS trailing_activation_percent REAL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE copied_positions DROP COLUMN IF EXISTS trailing_activation_percent`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions DROP COLUMN IF EXISTS trailing_percent`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions DROP COLUMN IF EXISTS tp_percent`,
    );
    await queryRunner.query(
      `ALTER TABLE copied_positions DROP COLUMN IF EXISTS sl_percent`,
    );
  }
}
