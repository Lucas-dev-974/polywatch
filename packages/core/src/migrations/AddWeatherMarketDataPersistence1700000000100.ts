import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherMarketDataPersistence1700000000100 implements MigrationInterface {
  name = 'AddWeatherMarketDataPersistence1700000000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE weather_forecast_history (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        forecast_date TIMESTAMP NOT NULL,
        metric TEXT NOT NULL,
        forecast_mean REAL NOT NULL,
        forecast_std_dev REAL NOT NULL,
        model_values_json TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wfh_city_date_metric ON weather_forecast_history (city, forecast_date, metric, fetched_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wfh_fetched_at ON weather_forecast_history (fetched_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE weather_market_snapshots (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        city_normalized TEXT NOT NULL,
        target_date_iso TEXT NOT NULL,
        metric TEXT NOT NULL,
        forecast_mean REAL,
        forecast_std_dev REAL,
        bucket_count INTEGER NOT NULL,
        total_bucket_count INTEGER NOT NULL,
        rule_id INTEGER,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wms_city_date_recorded ON weather_market_snapshots (city_normalized, target_date_iso, recorded_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wms_recorded_at ON weather_market_snapshots (recorded_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE weather_bucket_ticks (
        id SERIAL PRIMARY KEY,
        snapshot_id INTEGER NOT NULL REFERENCES weather_market_snapshots(id) ON DELETE CASCADE,
        condition_id TEXT NOT NULL,
        event_slug TEXT,
        question TEXT,
        bucket_comparison TEXT,
        bucket_target REAL,
        bucket_low REAL,
        bucket_high REAL,
        yes_price REAL,
        no_price REAL,
        yes_token_id TEXT,
        no_token_id TEXT,
        volume REAL,
        volume_24hr REAL,
        liquidity_clob REAL,
        accepting_orders BOOLEAN,
        closed BOOLEAN,
        end_date TIMESTAMP,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wbt_snapshot_id ON weather_bucket_ticks (snapshot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wbt_condition_id_recorded ON weather_bucket_ticks (condition_id, recorded_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wbt_recorded_at ON weather_bucket_ticks (recorded_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE weather_evaluation_log (
        id SERIAL PRIMARY KEY,
        snapshot_id INTEGER REFERENCES weather_market_snapshots(id) ON DELETE SET NULL,
        condition_id TEXT NOT NULL,
        bucket_comparison TEXT,
        bucket_target REAL,
        bucket_low REAL,
        bucket_high REAL,
        strategy_id TEXT NOT NULL,
        yes_price REAL,
        forecast_prob REAL,
        edge REAL,
        dynamic_min_edge REAL,
        decision TEXT NOT NULL,
        reason TEXT,
        evaluated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wel_snapshot_id ON weather_evaluation_log (snapshot_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wel_condition_id ON weather_evaluation_log (condition_id, evaluated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wel_strategy_id ON weather_evaluation_log (strategy_id, evaluated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wel_evaluated_at ON weather_evaluation_log (evaluated_at)`,
    );

    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_forecast_history_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_market_snapshot_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_evaluation_log_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_forecast_history_retention_days INTEGER NOT NULL DEFAULT 90`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_market_snapshot_retention_days INTEGER NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_evaluation_log_retention_days INTEGER NOT NULL DEFAULT 90`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_evaluation_log_retention_days`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_market_snapshot_retention_days`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_forecast_history_retention_days`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_evaluation_log_recording_enabled`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_market_snapshot_recording_enabled`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_forecast_history_recording_enabled`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS weather_evaluation_log CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_bucket_ticks CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_market_snapshots CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_forecast_history CASCADE`);
  }
}
