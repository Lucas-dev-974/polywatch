import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAlgoPriceTickMetrics1700000000021 implements MigrationInterface {
  name = 'AddAlgoPriceTickMetrics1700000000021';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_price_ticks"
        ADD COLUMN IF NOT EXISTS "up_bid" real,
        ADD COLUMN IF NOT EXISTS "up_ask" real,
        ADD COLUMN IF NOT EXISTS "down_bid" real,
        ADD COLUMN IF NOT EXISTS "down_ask" real,
        ADD COLUMN IF NOT EXISTS "up_spread_pct" real,
        ADD COLUMN IF NOT EXISTS "down_spread_pct" real,
        ADD COLUMN IF NOT EXISTS "up_ask_vwap" real,
        ADD COLUMN IF NOT EXISTS "down_ask_vwap" real,
        ADD COLUMN IF NOT EXISTS "price_gap" real,
        ADD COLUMN IF NOT EXISTS "seconds_until_end" integer,
        ADD COLUMN IF NOT EXISTS "book_staleness_ms" integer,
        ADD COLUMN IF NOT EXISTS "ws_healthy" boolean,
        ADD COLUMN IF NOT EXISTS "up_bid_size" real,
        ADD COLUMN IF NOT EXISTS "up_ask_size" real,
        ADD COLUMN IF NOT EXISTS "down_bid_size" real,
        ADD COLUMN IF NOT EXISTS "down_ask_size" real,
        ADD COLUMN IF NOT EXISTS "up_last_trade_price" real,
        ADD COLUMN IF NOT EXISTS "down_last_trade_price" real,
        ADD COLUMN IF NOT EXISTS "up_last_trade_size" real,
        ADD COLUMN IF NOT EXISTS "down_last_trade_size" real,
        ADD COLUMN IF NOT EXISTS "up_delta_1s" real,
        ADD COLUMN IF NOT EXISTS "down_delta_1s" real,
        ADD COLUMN IF NOT EXISTS "open_positions_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "open_exposure_usd" real,
        ADD COLUMN IF NOT EXISTS "unrealized_pnl" real,
        ADD COLUMN IF NOT EXISTS "last_signal_outcome" text,
        ADD COLUMN IF NOT EXISTS "last_signal_confidence" real,
        ADD COLUMN IF NOT EXISTS "last_signal_strategy_id" text,
        ADD COLUMN IF NOT EXISTS "signal_age_ms" integer
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_price_ticks"
        DROP COLUMN IF EXISTS "up_bid",
        DROP COLUMN IF EXISTS "up_ask",
        DROP COLUMN IF EXISTS "down_bid",
        DROP COLUMN IF EXISTS "down_ask",
        DROP COLUMN IF EXISTS "up_spread_pct",
        DROP COLUMN IF EXISTS "down_spread_pct",
        DROP COLUMN IF EXISTS "up_ask_vwap",
        DROP COLUMN IF EXISTS "down_ask_vwap",
        DROP COLUMN IF EXISTS "price_gap",
        DROP COLUMN IF EXISTS "seconds_until_end",
        DROP COLUMN IF EXISTS "book_staleness_ms",
        DROP COLUMN IF EXISTS "ws_healthy",
        DROP COLUMN IF EXISTS "up_bid_size",
        DROP COLUMN IF EXISTS "up_ask_size",
        DROP COLUMN IF EXISTS "down_bid_size",
        DROP COLUMN IF EXISTS "down_ask_size",
        DROP COLUMN IF EXISTS "up_last_trade_price",
        DROP COLUMN IF EXISTS "down_last_trade_price",
        DROP COLUMN IF EXISTS "up_last_trade_size",
        DROP COLUMN IF EXISTS "down_last_trade_size",
        DROP COLUMN IF EXISTS "up_delta_1s",
        DROP COLUMN IF EXISTS "down_delta_1s",
        DROP COLUMN IF EXISTS "open_positions_count",
        DROP COLUMN IF EXISTS "open_exposure_usd",
        DROP COLUMN IF EXISTS "unrealized_pnl",
        DROP COLUMN IF EXISTS "last_signal_outcome",
        DROP COLUMN IF EXISTS "last_signal_confidence",
        DROP COLUMN IF EXISTS "last_signal_strategy_id",
        DROP COLUMN IF EXISTS "signal_age_ms"
    `);
  }
}
