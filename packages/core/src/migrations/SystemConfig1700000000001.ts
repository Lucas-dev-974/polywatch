import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the system_config table for operational parameters
 * (timing, cache, performance) that were previously hardcoded.
 */
export class SystemConfig1700000000001 implements MigrationInterface {
  name = 'SystemConfig1700000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "system_config" (
        "key" character varying(128) PRIMARY KEY NOT NULL,
        "value" text NOT NULL,
        "category" character varying(64),
        "description" text,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Worker timing constants
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.heartbeat.interval_ms', '30000', 'worker', 'Worker heartbeat publish interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.book.subscription_sync_ms', '10000', 'worker', 'WebSocket book subscription reconciliation interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.ws.heartbeat_interval_ms', '10000', 'worker', 'WebSocket ping interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.ws.stale_book_threshold_ms', '30000', 'worker', 'Book staleness threshold for REST re-sync') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.ws.max_reconnect_attempts', '5', 'worker', 'Max WebSocket reconnect attempts') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.ws.connect_timeout_ms', '15000', 'worker', 'WebSocket connect timeout') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.ws.base_reconnect_delay_ms', '1000', 'worker', 'WebSocket reconnect backoff base delay') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.market_resolution.loop_ms', '15000', 'worker', 'Market resolution watcher poll interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.redemption.loop_ms', '15000', 'worker', 'Redemption handler poll interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.closing_watchdog.loop_ms', '15000', 'worker', 'Closing watchdog poll interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.forced_exit.retry_cooldown_ms', '5000', 'worker', 'Min spacing between forced exit retries') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.sl_confirmation.min_window_ms', '500', 'worker', 'Min window for SL confirmation') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.reservation_janitor.loop_ms', '60000', 'worker', 'Reservation janitor poll interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.placing_janitor.loop_ms', '60000', 'worker', 'Placing janitor poll interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.strategy.eval_interval_ms', '100', 'worker', 'Strategy evaluation loop interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.backend_ready.timeout_ms', '60000', 'worker', 'Backend ready signal timeout') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.data_api.page_limit', '500', 'worker', 'Data API page limit per request') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.data_api.max_pages', '20', 'worker', 'Max pagination pages') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.pnl_tick.throttle_ms', '100', 'worker', 'PnL tick throttle') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.kill_switch.check_interval_ms', '10000', 'worker', 'Kill switch re-check interval') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.market_refresh.throttle_ms', '15000', 'worker', 'Market lifecycle refresh throttle') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.real_balance.cache_ttl_ms', '10000', 'worker', 'Real pUSD balance cache TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.tick_size.cache_ttl_ms', '300000', 'worker', 'Tick size cache TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.clob.order_timeout_ms', '30000', 'worker', 'CLOB order timeout') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.fee_rate.cache_ttl_ms', '300000', 'worker', 'Fee rate cache TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.book_freshness.warn_max_age_ms', '30000', 'worker', 'Book staleness warning threshold') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.last_trade_price.max_age_ms', '60000', 'worker', 'Last trade price staleness threshold') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.clob.amount_decimals', '6', 'worker', 'CLOB amount decimals') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.clob.position_lock_timeout_ms', '60000', 'worker', 'Position lock timeout') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.circuit_breaker.failure_threshold', '5', 'worker', 'Circuit breaker failure threshold') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('worker.circuit_breaker.cooldown_ms', '30000', 'worker', 'Circuit breaker cooldown') ON CONFLICT DO NOTHING`);

    // Surveillance constants
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('surveillance.open_snapshot_delay_ms', '5000', 'surveillance', 'Delay before capturing open snapshot') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('surveillance.close_snapshot_delay_ms', '2000', 'surveillance', 'Delay before capturing close snapshot') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('surveillance.close_ttl_ms', '300000', 'surveillance', 'Max wait for close snapshot') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('surveillance.redemption_win_threshold', '0.99', 'surveillance', 'Price threshold for redemption win') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('surveillance.redemption_loss_threshold', '0.01', 'surveillance', 'Price threshold for redemption loss') ON CONFLICT DO NOTHING`);

    // Auto-track constants
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.fetch_page_size', '100', 'auto_track', 'Gamma pagination page size') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.max_pages', '6', 'auto_track', 'Max Gamma pagination pages') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.sync_min_interval_ms', '10000', 'auto_track', 'Auto-track sync throttle') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.future_markets_sync_min_interval_ms', '30000', 'auto_track', 'Future markets sync throttle') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.janitor.short_interval_ms', '30000', 'auto_track', 'Janitor cadence for short intervals') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('auto_track.janitor.default_interval_ms', '60000', 'auto_track', 'Default janitor cadence') ON CONFLICT DO NOTHING`);

    // Backend cache constants
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('backend.cache.market_tags.ttl_ms', '86400000', 'backend', 'Market tags cache TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('backend.cache.funding.ttl_ms', '21600000', 'backend', 'Funding cache TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('backend.auth.refresh_token.ttl_seconds', '604800', 'backend', 'Refresh token TTL') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('backend.polygonscan.max_offset', '1000', 'backend', 'Polygonscan max offset') ON CONFLICT DO NOTHING`);
    await queryRunner.query(`INSERT INTO "system_config" ("key", "value", "category", "description") VALUES ('backend.polygonscan.max_windows', '1000', 'backend', 'Polygonscan max windows') ON CONFLICT DO NOTHING`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "system_config"`);
  }
}
