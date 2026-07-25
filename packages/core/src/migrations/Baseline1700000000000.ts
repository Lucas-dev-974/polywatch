import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline migration: creates all 15 entity tables.
 *
 * Uses IF NOT EXISTS so it is idempotent on an already-synchronized database.
 * This is the starting point for all future schema migrations.
 */
export class Baseline1700000000000 implements MigrationInterface {
  name = 'Baseline1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "username" text NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Markets
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "markets" (
        "condition_id" text PRIMARY KEY NOT NULL,
        "question" text,
        "slug" text,
        "event_slug" text,
        "category" text,
        "icon" text,
        "tag_slugs" text NOT NULL DEFAULT '[]',
        "end_date" timestamp,
        "token_id_yes" text,
        "token_id_no" text,
        "neg_risk" boolean NOT NULL DEFAULT false,
        "fee_rate" double precision NOT NULL DEFAULT 0,
        "fee_exponent" double precision NOT NULL DEFAULT 1,
        "active" boolean NOT NULL DEFAULT true,
        "resolved" boolean NOT NULL DEFAULT false,
        "closed" boolean NOT NULL DEFAULT false,
        "accepting_orders" boolean,
        "winning_token_id" text,
        "updated_at" timestamp
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_markets_closed_accepting"
      ON "markets" ("closed", "accepting_orders")
    `);

    // Executions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "executions" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "order_signal_id" text NOT NULL UNIQUE,
        "copied_position_id" integer NOT NULL,
        "mode" text NOT NULL,
        "side" text NOT NULL,
        "order_type" text,
        "requested_qty" double precision,
        "fill_price" double precision,
        "fill_quantity" double precision,
        "reference_vwap" double precision,
        "fees" double precision NOT NULL DEFAULT 0,
        "realized_pnl" double precision NOT NULL DEFAULT 0,
        "status" text NOT NULL,
        "reason" text,
        "tx_hash" text,
        "clob_order_id" text,
        "error" text,
        "executed_at" timestamp,
        "version" integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_executions_position_side_status"
      ON "executions" ("copied_position_id", "side", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_executions_status"
      ON "executions" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_executions_mode_executed"
      ON "executions" ("mode", "executed_at")
    `);

    // Watchlist
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "watchlist" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "trader_address" text NOT NULL,
        "nickname" text,
        "active" boolean NOT NULL DEFAULT true,
        "sim_enabled" boolean NOT NULL DEFAULT true,
        "real_enabled" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_watchlist_trader"
      ON "watchlist" ("trader_address")
    `);

    // Copied positions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "copied_positions" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "watchlist_id" integer NOT NULL,
        "move_event_id" text,
        "condition_id" text NOT NULL,
        "asset_id" text NOT NULL,
        "outcome" text NOT NULL,
        "side" text NOT NULL DEFAULT 'BUY',
        "quantity" double precision NOT NULL,
        "entry_price" double precision NOT NULL,
        "entry_bid_vwap" double precision NOT NULL,
        "entry_fees" double precision NOT NULL DEFAULT 0,
        "entry_quantity_remaining" double precision,
        "entry_fees_remaining" double precision NOT NULL DEFAULT 0,
        "executable_bid_vwap" double precision,
        "unrealized_pnl" double precision NOT NULL DEFAULT 0,
        "realized_pnl" double precision NOT NULL DEFAULT 0,
        "peak_closure_pnl_percent" double precision,
        "closing_attempt_seq" integer NOT NULL DEFAULT 0,
        "liquidity_status" text NOT NULL DEFAULT 'ok',
        "book_updated_at" timestamp,
        "sl_percent" double precision,
        "tp_percent" double precision,
        "trailing_stop_percent" double precision,
        "trailing_activation_percent" double precision,
        "status" text NOT NULL DEFAULT 'open',
        "mode" text NOT NULL,
        "opened_at" timestamp,
        "closed_at" timestamp,
        "close_reason" text,
        "closing_started_at" timestamp,
        "increase_count" integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_copied_positions_status_mode"
      ON "copied_positions" ("status", "mode")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_copied_positions_condition"
      ON "copied_positions" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_copied_positions_closing"
      ON "copied_positions" ("status", "closing_started_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_copied_positions_lookup"
      ON "copied_positions" ("watchlist_id", "condition_id", "asset_id", "mode", "status")
    `);

    // Simulation state snapshots
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "simulation_state_snapshots" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "label" text,
        "source" text NOT NULL,
        "amount" double precision NOT NULL,
        "token" text NOT NULL DEFAULT 'pUSD',
        "positions_value" double precision NOT NULL,
        "equity" double precision NOT NULL,
        "open_pnl_sum" double precision NOT NULL,
        "closed_pnl_sum" double precision NOT NULL,
        "baseline_capital" double precision NOT NULL,
        "position_count" integer NOT NULL,
        "open_position_count" integer NOT NULL,
        "closed_position_count" integer NOT NULL,
        "execution_count" integer NOT NULL,
        "trader_count" integer NOT NULL,
        "traders_label" text NOT NULL,
        "config_json" text NOT NULL,
        "traders_json" text NOT NULL,
        "positions_json" text NOT NULL,
        "executions_json" text NOT NULL
      )
    `);

    // Move events
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "move_events" (
        "id" text PRIMARY KEY NOT NULL,
        "trader_address" text NOT NULL,
        "condition_id" text NOT NULL,
        "asset_id" text NOT NULL,
        "outcome" text,
        "event_type" text NOT NULL,
        "previous_trader_size" double precision NOT NULL,
        "trader_size" double precision NOT NULL,
        "trader_avg_price" double precision,
        "snapshot_seq" integer NOT NULL,
        "processed" boolean NOT NULL DEFAULT false,
        "detected_at" timestamp NOT NULL,
        "skip_reasons" text
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_move_events_trader_asset"
      ON "move_events" ("trader_address", "condition_id", "asset_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_move_events_processed"
      ON "move_events" ("processed")
    `);

    // Simulation balances
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "simulation_balances" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "token" text NOT NULL DEFAULT 'pUSD',
        "amount" double precision NOT NULL,
        "baseline_capital" double precision,
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Trader snapshots
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trader_snapshots" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "trader_address" text NOT NULL,
        "condition_id" text NOT NULL,
        "asset_id" text NOT NULL,
        "outcome" text,
        "size" double precision NOT NULL,
        "avg_price" double precision,
        "snapshot_seq" integer NOT NULL,
        "snapshot_at" timestamp NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_trader_snapshots_unique"
      ON "trader_snapshots" ("trader_address", "condition_id", "asset_id")
    `);

    // Position reservations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "position_reservations" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "order_signal_id" text NOT NULL UNIQUE,
        "copied_position_id" integer NOT NULL,
        "watchlist_id" integer NOT NULL,
        "condition_id" text NOT NULL,
        "asset_id" text NOT NULL,
        "mode" text NOT NULL,
        "reserved_notional_usdc" double precision NOT NULL,
        "reason" text NOT NULL,
        "created_at" timestamp NOT NULL,
        "expires_at" timestamp NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_reservations_expires"
      ON "position_reservations" ("expires_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_reservations_mode_expires"
      ON "position_reservations" ("mode", "expires_at")
    `);

    // Wallet accounts
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet_accounts" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "label" text NOT NULL,
        "deposit_address" text NOT NULL,
        "funder_address" text,
        "signer_pk_enc" text,
        "signature_type" integer NOT NULL DEFAULT 3,
        "is_primary" boolean NOT NULL DEFAULT false,
        "sort_order" integer NOT NULL DEFAULT 0,
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // CLOB credentials
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "clob_credentials" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "wallet_address" text NOT NULL,
        "api_key_enc" text,
        "secret_enc" text,
        "passphrase_enc" text,
        "signer_pk_enc" text,
        "signature_type" integer NOT NULL DEFAULT 0,
        "funder_address" text,
        "builder_api_key_enc" text,
        "builder_secret_enc" text,
        "builder_passphrase_enc" text,
        "relayer_url" text,
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Trader snapshot seq
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trader_snapshot_seq" (
        "trader_address" text PRIMARY KEY NOT NULL,
        "seq" integer NOT NULL DEFAULT 0
      )
    `);

    // Risk config
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "risk_config" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "sim_max_open_positions" integer NOT NULL DEFAULT 10,
        "real_max_open_positions" integer NOT NULL DEFAULT 10,
        "max_exposure_usdc" double precision NOT NULL DEFAULT 1000,
        "max_daily_loss_usdc" double precision NOT NULL DEFAULT 100,
        "max_position_size_usdc" double precision NOT NULL DEFAULT 200,
        "max_slippage_percent" double precision NOT NULL DEFAULT 2,
        "sim_min_bid_to_ask_ratio" double precision NOT NULL DEFAULT 0.9,
        "real_min_bid_to_ask_ratio" double precision NOT NULL DEFAULT 0.9,
        "sim_momentum_filter_enabled" boolean NOT NULL DEFAULT false,
        "real_momentum_filter_enabled" boolean NOT NULL DEFAULT false,
        "exit_slippage_guard_percent" double precision NOT NULL DEFAULT 50,
        "pre_close_seconds" integer NOT NULL DEFAULT 60,
        "pre_close_hold_if_winning" boolean NOT NULL DEFAULT true,
        "kill_switch_action" text NOT NULL DEFAULT 'block_entries',
        "real_trading_enabled" boolean NOT NULL DEFAULT false,
        "sim_sizing_mode" text NOT NULL DEFAULT 'fixed_usdc',
        "sim_copy_ratio" double precision NOT NULL DEFAULT 1.0,
        "sim_entry_usdc_amount" double precision NOT NULL DEFAULT 10,
        "sim_kelly_fraction" double precision NOT NULL DEFAULT 0.25,
        "sim_risk_budget_usdc" double precision NOT NULL DEFAULT 10,
        "sim_default_win_probability" double precision NOT NULL DEFAULT 0.55,
        "sim_initial_capital" double precision NOT NULL DEFAULT 1000,
        "real_sizing_mode" text NOT NULL DEFAULT 'fixed_usdc',
        "real_copy_ratio" double precision NOT NULL DEFAULT 1.0,
        "real_entry_usdc_amount" double precision NOT NULL DEFAULT 10,
        "real_kelly_fraction" double precision NOT NULL DEFAULT 0.25,
        "real_risk_budget_usdc" double precision NOT NULL DEFAULT 10,
        "real_default_win_probability" double precision NOT NULL DEFAULT 0.55,
        "sim_sl_percent" double precision NOT NULL DEFAULT 5,
        "sim_tp_percent" double precision NOT NULL DEFAULT 15,
        "sim_trailing_enabled" boolean NOT NULL DEFAULT true,
        "sim_trailing_stop_percent" double precision NOT NULL DEFAULT 10,
        "sim_trailing_activation_percent" double precision NOT NULL DEFAULT 0,
        "real_sl_percent" double precision NOT NULL DEFAULT 5,
        "real_tp_percent" double precision NOT NULL DEFAULT 15,
        "real_trailing_enabled" boolean NOT NULL DEFAULT true,
        "real_trailing_stop_percent" double precision NOT NULL DEFAULT 10,
        "real_trailing_activation_percent" double precision NOT NULL DEFAULT 0,
        "sim_sl_tp_enabled" boolean NOT NULL DEFAULT true,
        "real_sl_tp_enabled" boolean NOT NULL DEFAULT true,
        "pre_close_enabled" boolean NOT NULL DEFAULT true,
        "copy_increase_enabled" boolean NOT NULL DEFAULT true,
        "copy_decrease_enabled" boolean NOT NULL DEFAULT true,
        "max_increases_per_position" integer NOT NULL DEFAULT 0,
        "sim_max_position_size_usdc" double precision NOT NULL DEFAULT 200,
        "real_max_position_size_usdc" double precision NOT NULL DEFAULT 200,
        "sim_max_exposure_usdc" double precision NOT NULL DEFAULT 1000,
        "real_max_exposure_usdc" double precision NOT NULL DEFAULT 1000,
        "sim_max_daily_loss_usdc" double precision NOT NULL DEFAULT 100,
        "real_max_daily_loss_usdc" double precision NOT NULL DEFAULT 100,
        "sim_kill_switch_action" text NOT NULL DEFAULT 'block_entries',
        "real_kill_switch_action" text NOT NULL DEFAULT 'block_entries',
        "sim_copy_increase_enabled" boolean NOT NULL DEFAULT true,
        "real_copy_increase_enabled" boolean NOT NULL DEFAULT true,
        "sim_copy_decrease_enabled" boolean NOT NULL DEFAULT true,
        "real_copy_decrease_enabled" boolean NOT NULL DEFAULT true,
        "sim_max_increases_per_position" integer NOT NULL DEFAULT 0,
        "real_max_increases_per_position" integer NOT NULL DEFAULT 0,
        "sim_copy_increase_sl_proximity_enabled" boolean NOT NULL DEFAULT false,
        "real_copy_increase_sl_proximity_enabled" boolean NOT NULL DEFAULT false,
        "sim_copy_increase_sl_proximity_percent" double precision NOT NULL DEFAULT 80,
        "real_copy_increase_sl_proximity_percent" double precision NOT NULL DEFAULT 80,
        "sim_pre_close_enabled" boolean NOT NULL DEFAULT true,
        "real_pre_close_enabled" boolean NOT NULL DEFAULT true,
        "sim_pre_close_seconds" integer NOT NULL DEFAULT 60,
        "real_pre_close_seconds" integer NOT NULL DEFAULT 60,
        "sim_min_time_to_close" integer NOT NULL DEFAULT 0,
        "real_min_time_to_close" integer NOT NULL DEFAULT 0,
        "sim_pre_close_hold_if_winning" boolean NOT NULL DEFAULT true,
        "real_pre_close_hold_if_winning" boolean NOT NULL DEFAULT true,
        "sim_allowed_market_tags" text NOT NULL DEFAULT '[]',
        "real_allowed_market_tags" text NOT NULL DEFAULT '[]',
        "sim_signal_score_sizing_enabled" boolean NOT NULL DEFAULT true,
        "real_signal_score_sizing_enabled" boolean NOT NULL DEFAULT true,
        "sim_auto_snapshot_enabled" boolean NOT NULL DEFAULT false,
        "sim_auto_snapshot_interval_seconds" integer NOT NULL DEFAULT 3600,
        "move_detector_interval_ms" integer NOT NULL DEFAULT 2000
      )
    `);

    // Integration settings
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "integration_settings" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "polygonscan_api_key_enc" text,
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_config"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trader_snapshot_seq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clob_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "position_reservations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trader_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "simulation_balances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "move_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "simulation_state_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "copied_positions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "watchlist"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "executions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "markets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}