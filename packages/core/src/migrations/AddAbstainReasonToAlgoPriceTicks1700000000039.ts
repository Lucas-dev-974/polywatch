import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAbstainReasonToAlgoPriceTicks1700000000039 implements MigrationInterface {
  name = 'AddAbstainReasonToAlgoPriceTicks1700000000039';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE algo_price_ticks
        ADD COLUMN IF NOT EXISTS last_abstain_reason text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE algo_price_ticks
        DROP COLUMN IF EXISTS last_abstain_reason
    `);
  }
}
