import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the `reserved_notional_usdc` column on `position_reservations` to
 * `reserved_notional_pusd` to reflect that the reserved notional is denominated
 * in pUSD (the internal collateral unit), not USDC.
 */
export class RenameNotionalUsdcToPusd1700000000123 implements MigrationInterface {
  name = 'RenameNotionalUsdcToPusd1700000000123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "position_reservations" RENAME COLUMN "reserved_notional_usdc" TO "reserved_notional_pusd"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "position_reservations" RENAME COLUMN "reserved_notional_pusd" TO "reserved_notional_usdc"`,
    );
  }
}
