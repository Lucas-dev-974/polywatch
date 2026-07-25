import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimSessionArchives1700000000049 implements MigrationInterface {
  name = 'AddSimSessionArchives1700000000049';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE simulation_sessions
        ADD COLUMN IF NOT EXISTS archive_summary_json text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sim_archive_positions (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        condition_id text NOT NULL,
        asset_id text NOT NULL,
        market_title text,
        outcome text NOT NULL,
        side text NOT NULL,
        size real NOT NULL,
        entry_price real NOT NULL,
        exit_price real,
        realized_pnl real NOT NULL DEFAULT 0,
        close_reason text,
        reason text,
        opened_at TIMESTAMP,
        closed_at TIMESTAMP,
        raw_json text NOT NULL,
        CONSTRAINT PK_sim_archive_positions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_archive_positions_session
      ON sim_archive_positions (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sim_archive_executions (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        copied_position_id integer NOT NULL,
        side text NOT NULL,
        fill_price real,
        fill_quantity real,
        fees real NOT NULL DEFAULT 0,
        realized_pnl real NOT NULL DEFAULT 0,
        status text NOT NULL,
        reason text,
        executed_at TIMESTAMP,
        raw_json text NOT NULL,
        CONSTRAINT PK_sim_archive_executions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_archive_executions_session
      ON sim_archive_executions (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sim_archive_exit_attempts (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        copied_position_id integer NOT NULL,
        kind text NOT NULL,
        close_reason text NOT NULL,
        block_reason text,
        error text,
        mark_bid real,
        created_at TIMESTAMP NOT NULL,
        raw_json text NOT NULL,
        CONSTRAINT PK_sim_archive_exit_attempts PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_archive_exit_attempts_session
      ON sim_archive_exit_attempts (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sim_archive_surveillance (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source_id integer NOT NULL,
        condition_id text NOT NULL,
        question text,
        crypto_symbol text,
        interval text,
        slug text,
        market_start_at TIMESTAMP,
        market_end_at TIMESTAMP,
        open_up_price real,
        open_down_price real,
        close_up_price real,
        close_down_price real,
        winning_outcome text,
        positions_json text,
        raw_json text NOT NULL,
        CONSTRAINT PK_sim_archive_surveillance PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_archive_surveillance_session
      ON sim_archive_surveillance (session_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sim_archive_price_candles (
        id SERIAL NOT NULL,
        session_id integer NOT NULL,
        source text NOT NULL,
        condition_id text NOT NULL,
        asset_id text,
        bucket_start TIMESTAMP NOT NULL,
        open real NOT NULL,
        high real NOT NULL,
        low real NOT NULL,
        close real NOT NULL,
        tick_count integer NOT NULL DEFAULT 0,
        CONSTRAINT PK_sim_archive_price_candles PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sim_archive_candles_session_bucket
      ON sim_archive_price_candles (session_id, bucket_start)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_archive_candles_session_bucket`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_archive_price_candles`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_archive_surveillance_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_archive_surveillance`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_archive_exit_attempts_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_archive_exit_attempts`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_archive_executions_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_archive_executions`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sim_archive_positions_session`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_archive_positions`);
    await queryRunner.query(`
      ALTER TABLE simulation_sessions
        DROP COLUMN IF EXISTS archive_summary_json
    `);
  }
}
