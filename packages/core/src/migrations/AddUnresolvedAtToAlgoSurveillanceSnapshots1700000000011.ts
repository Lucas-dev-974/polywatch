import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnresolvedAtToAlgoSurveillanceSnapshots1700000000011
  implements MigrationInterface
{
  name = 'AddUnresolvedAtToAlgoSurveillanceSnapshots1700000000011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_surveillance_snapshots"
      ADD COLUMN IF NOT EXISTS "unresolved_at" timestamp
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_surveillance_snapshots"
      DROP COLUMN IF EXISTS "unresolved_at"
    `);
  }
}