import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns the risk_config and copied_positions tables with the current entity
 * definitions after the v1.1 refactoring:
 *
 * DROPS (risk_config):
 *  - crypto_algo_sl_percent, crypto_algo_tp_percent
 *  - crypto_algo_trailing_stop_percent, crypto_algo_trailing_activation_percent
 *  - crypto_algo_pre_close_hold_if_winning, crypto_algo_pre_close_win_confidence_bid
 *  - crypto_algo_time_exit_enabled, crypto_algo_time_exit_seconds
 *  - crypto_algo_time_exit_win_confidence_bid, crypto_algo_time_exit_max_retries
 *  - crypto_algo_time_exit_last_trade_max_age_seconds
 *  - crypto_algo_time_exit_seconds_by_interval
 *
 * ADDS (risk_config):
 *  - sim_trailing_bid_points, sim_trailing_activation_bid_points
 *  - real_trailing_bid_points, real_trailing_activation_bid_points
 *  - sim_pre_close_enabled, real_pre_close_enabled
 *  - sim_pre_close_seconds, real_pre_close_seconds
 *  - sim_min_time_to_close, real_min_time_to_close
 *  - sim_pre_close_keep_enabled, sim_pre_close_keep_bid_threshold
 *  - real_pre_close_keep_enabled, real_pre_close_keep_bid_threshold
 *  - crypto_algo_trailing_bid_points, crypto_algo_trailing_activation_bid_points
 *  - crypto_algo_pre_close_keep_enabled, crypto_algo_pre_close_keep_bid_threshold
 *  - crypto_algo_min_time_to_close
 *  - crypto_algo_sizing_mode, crypto_algo_entry_usdc_amount, crypto_algo_entry_share_count
 *  - real_auto_snapshot_enabled, real_auto_snapshot_interval_seconds
 *  - real_snapshot_max_count, real_snapshot_retention_days
 *  - real_snapshot_decision_window_hours
 *
 * ADDS (copied_positions):
 *  - peak_bid_vwap, trailing_bid_points, trailing_activation_bid_points
 */
export class AlignRiskConfigWithEntityV2170000000057 implements MigrationInterface {
  name = 'AlignRiskConfigWithEntityV2170000000057';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── DROP old columns from risk_config ──────────────────────────────
    const dropColumns = [
      'crypto_algo_sl_percent',
      'crypto_algo_tp_percent',
      'crypto_algo_trailing_stop_percent',
      'crypto_algo_trailing_activation_percent',
      'crypto_algo_pre_close_hold_if_winning',
      'crypto_algo_pre_close_win_confidence_bid',
      'crypto_algo_time_exit_enabled',
      'crypto_algo_time_exit_seconds',
      'crypto_algo_time_exit_win_confidence_bid',
      'crypto_algo_time_exit_max_retries',
      'crypto_algo_time_exit_last_trade_max_age_seconds',
      'crypto_algo_time_exit_seconds_by_interval',
    ];

    for (const col of dropColumns) {
      await queryRunner.query(`
        ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "${col}"
      `);
    }

    // ── ADD new columns to risk_config ─────────────────────────────────
    // Copy trailing bid points (sim/real)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_trailing_bid_points" real NOT NULL DEFAULT 0.05
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_trailing_activation_bid_points" real NOT NULL DEFAULT 0.06
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_trailing_bid_points" real NOT NULL DEFAULT 0.05
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_trailing_activation_bid_points" real NOT NULL DEFAULT 0.06
    `);

    // Copy pre-close (sim/real)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_pre_close_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_pre_close_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_pre_close_seconds" integer NOT NULL DEFAULT 60
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_pre_close_seconds" integer NOT NULL DEFAULT 60
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_min_time_to_close" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_min_time_to_close" integer NOT NULL DEFAULT 0
    `);

    // Copy pre-close keep (sim/real)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_pre_close_keep_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_pre_close_keep_bid_threshold" real NOT NULL DEFAULT 0.80
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_pre_close_keep_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_pre_close_keep_bid_threshold" real NOT NULL DEFAULT 0.80
    `);

    // Crypto-algo trailing bid points (nullable overrides)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_bid_points" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_activation_bid_points" real
    `);

    // Crypto-algo pre-close keep (nullable overrides)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_keep_enabled" boolean
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_keep_bid_threshold" real
    `);

    // Crypto-algo min time to close (nullable override)
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_min_time_to_close" integer
    `);

    // Crypto-algo sizing
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_sizing_mode" text NOT NULL DEFAULT 'fixed_usdc'
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_entry_usdc_amount" real NOT NULL DEFAULT 10
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_entry_share_count" real
    `);

    // Real-mode snapshot columns
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_auto_snapshot_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_auto_snapshot_interval_seconds" integer NOT NULL DEFAULT 3600
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_snapshot_max_count" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_snapshot_retention_days" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_snapshot_decision_window_hours" integer NOT NULL DEFAULT 24
    `);

    // ── ADD new columns to copied_positions ────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "peak_bid_vwap" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "trailing_bid_points" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "trailing_activation_bid_points" real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // ── RESTORE dropped columns (risk_config) ───────────────────────────
    const restoreColumns: [string, string][] = [
      ['crypto_algo_sl_percent', 'real'],
      ['crypto_algo_tp_percent', 'real'],
      ['crypto_algo_trailing_stop_percent', 'real'],
      ['crypto_algo_trailing_activation_percent', 'real'],
      ['crypto_algo_pre_close_hold_if_winning', 'boolean'],
      ['crypto_algo_pre_close_win_confidence_bid', 'real'],
      ['crypto_algo_time_exit_enabled', 'boolean'],
      ['crypto_algo_time_exit_seconds', 'integer'],
      ['crypto_algo_time_exit_win_confidence_bid', 'real'],
      ['crypto_algo_time_exit_max_retries', 'integer'],
      ['crypto_algo_time_exit_last_trade_max_age_seconds', 'integer'],
      ['crypto_algo_time_exit_seconds_by_interval', 'text'],
    ];

    for (const [name, type] of restoreColumns) {
      await queryRunner.query(`
        ALTER TABLE "risk_config" ADD COLUMN IF NOT EXISTS "${name}" ${type}
      `);
    }

    // ── DROP added columns (risk_config) ────────────────────────────────
    const addedColumns = [
      'sim_trailing_bid_points',
      'sim_trailing_activation_bid_points',
      'real_trailing_bid_points',
      'real_trailing_activation_bid_points',
      'sim_pre_close_enabled',
      'real_pre_close_enabled',
      'sim_pre_close_seconds',
      'real_pre_close_seconds',
      'sim_min_time_to_close',
      'real_min_time_to_close',
      'sim_pre_close_keep_enabled',
      'sim_pre_close_keep_bid_threshold',
      'real_pre_close_keep_enabled',
      'real_pre_close_keep_bid_threshold',
      'crypto_algo_trailing_bid_points',
      'crypto_algo_trailing_activation_bid_points',
      'crypto_algo_pre_close_keep_enabled',
      'crypto_algo_pre_close_keep_bid_threshold',
      'crypto_algo_min_time_to_close',
      'crypto_algo_sizing_mode',
      'crypto_algo_entry_usdc_amount',
      'crypto_algo_entry_share_count',
      'real_auto_snapshot_enabled',
      'real_auto_snapshot_interval_seconds',
      'real_snapshot_max_count',
      'real_snapshot_retention_days',
      'real_snapshot_decision_window_hours',
    ];

    for (const col of addedColumns) {
      await queryRunner.query(`
        ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "${col}"
      `);
    }

    // ── DROP added columns (copied_positions) ───────────────────────────
    await queryRunner.query(`
      ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "peak_bid_vwap"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "trailing_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "trailing_activation_bid_points"
    `);
  }
}
