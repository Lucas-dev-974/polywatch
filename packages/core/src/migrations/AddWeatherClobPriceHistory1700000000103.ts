import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherClobPriceHistory1700000000103 implements MigrationInterface {
  name = 'AddWeatherClobPriceHistory1700000000103';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE weather_history_ingest_jobs (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        metric TEXT NOT NULL,
        from_date DATE NOT NULL,
        to_date DATE NOT NULL,
        fidelity_minutes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        markets_total INTEGER NOT NULL DEFAULT 0,
        markets_done INTEGER NOT NULL DEFAULT 0,
        markets_empty INTEGER NOT NULL DEFAULT 0,
        points_upserted INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_whij_city_status ON weather_history_ingest_jobs (city, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_whij_created_at ON weather_history_ingest_jobs (created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE weather_clob_price_history (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        target_date DATE NOT NULL,
        metric TEXT NOT NULL,
        condition_id TEXT NOT NULL,
        event_slug TEXT,
        question TEXT,
        bucket_comparison TEXT,
        bucket_target REAL,
        bucket_low REAL,
        bucket_high REAL,
        side TEXT NOT NULL,
        token_id TEXT NOT NULL,
        price REAL NOT NULL,
        recorded_at TIMESTAMP NOT NULL,
        fidelity_minutes INTEGER NOT NULL,
        ingest_job_id INTEGER REFERENCES weather_history_ingest_jobs(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (condition_id, side, recorded_at)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_wcph_city_target_recorded ON weather_clob_price_history (city, target_date, recorded_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wcph_ingest_job_id ON weather_clob_price_history (ingest_job_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS weather_clob_price_history CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_history_ingest_jobs CASCADE`);
  }
}
