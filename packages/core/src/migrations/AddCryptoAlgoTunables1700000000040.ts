import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoTunables1700000000040 implements MigrationInterface {
  name = 'AddCryptoAlgoTunables1700000000040';

  async up(queryRunner: QueryRunner): Promise<void> {
    const scalarColumns: [string, string][] = [
      ['crypto_algo_base_threshold', 'real'],
      ['crypto_algo_spread_adjustment_factor', 'real'],
      ['crypto_algo_min_spread_abs_for_adjustment', 'real'],
      ['crypto_algo_max_spread_abs', 'real'],
      ['crypto_algo_price_sum_tolerance', 'real'],
      ['crypto_algo_warn_price_deviation', 'real'],
      ['crypto_algo_max_book_age_ms', 'integer'],
      ['crypto_algo_gamma_cache_ttl_short_ms', 'integer'],
      ['crypto_algo_gamma_cache_ttl_default_ms', 'integer'],
      ['crypto_algo_gamma_stale_on_error_factor', 'real'],
      ['crypto_algo_ws_debounce_ms', 'integer'],
      ['crypto_algo_poll_ms', 'integer'],
      ['crypto_algo_tick_interval_ms', 'integer'],
      ['crypto_algo_tick_retention_hours', 'integer'],
      ['crypto_algo_price_tick_ref_qty', 'real'],
      ['crypto_algo_min_time_to_close_buffer_seconds', 'integer'],
      ['crypto_algo_last_closeable_bid_max_age_ms', 'integer'],
    ];

    for (const [name, type] of scalarColumns) {
      await queryRunner.query(`
        ALTER TABLE risk_config
          ADD COLUMN IF NOT EXISTS ${name} ${type}
      `);
    }

    const jsonColumns = [
      'crypto_algo_spread_abs_by_interval',
      'crypto_algo_exit_defaults_by_interval',
      'crypto_algo_pre_close_seconds_by_interval',
      'crypto_algo_time_exit_seconds_by_interval',
    ];

    for (const name of jsonColumns) {
      await queryRunner.query(`
        ALTER TABLE risk_config
          ADD COLUMN IF NOT EXISTS ${name} text
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      'crypto_algo_time_exit_seconds_by_interval',
      'crypto_algo_pre_close_seconds_by_interval',
      'crypto_algo_exit_defaults_by_interval',
      'crypto_algo_spread_abs_by_interval',
      'crypto_algo_last_closeable_bid_max_age_ms',
      'crypto_algo_min_time_to_close_buffer_seconds',
      'crypto_algo_price_tick_ref_qty',
      'crypto_algo_tick_retention_hours',
      'crypto_algo_tick_interval_ms',
      'crypto_algo_poll_ms',
      'crypto_algo_ws_debounce_ms',
      'crypto_algo_gamma_stale_on_error_factor',
      'crypto_algo_gamma_cache_ttl_default_ms',
      'crypto_algo_gamma_cache_ttl_short_ms',
      'crypto_algo_max_book_age_ms',
      'crypto_algo_warn_price_deviation',
      'crypto_algo_price_sum_tolerance',
      'crypto_algo_max_spread_abs',
      'crypto_algo_min_spread_abs_for_adjustment',
      'crypto_algo_spread_adjustment_factor',
      'crypto_algo_base_threshold',
    ];

    for (const name of columns) {
      await queryRunner.query(`
        ALTER TABLE risk_config
          DROP COLUMN IF EXISTS ${name}
      `);
    }
  }
}
