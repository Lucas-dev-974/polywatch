import 'reflect-metadata';
import { newDb, DataType } from 'pg-mem';
import type { DataSource } from 'typeorm';
import { entities } from './data-source.js';

/**
 * Create an in-memory PostgreSQL DataSource for unit tests using pg-mem.
 *
 * This replaces the old `createDataSource(':memory:', { synchronize: true })`
 * pattern that relied on SQLite. pg-mem emulates a real Postgres backend in
 * memory — no Docker or external service required.
 *
 * The returned DataSource is **not** initialized. Call `await ds.initialize()`
 * (or use the existing `initializeDataSource()` helper) before running queries.
 *
 * `synchronize` defaults to `true` so the schema is auto-created from entities,
 * matching the previous SQLite behaviour. `migrationsRun` is always `false`.
 */
export function createTestDataSource(): DataSource {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  // TypeORM's postgres driver probes these on connect; pg-mem does not
  // implement them natively.
  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 14.0 (pg-mem)',
  });
  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'polywatch_test',
  });
  // pg-mem cannot subtract a timestamp column from now() (timestamptz);
  // real Postgres coerces implicitly. Intervals are plain objects in pg-mem,
  // and EXTRACT(EPOCH FROM ...) reads their `seconds` field.
  // Advisory locks are meaningless on a single in-memory connection: no-op.
  db.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.text],
    returns: DataType.null,
    impure: true,
    implementation: () => null,
  });
  db.public.registerOperator({
    operator: '-',
    left: DataType.timestamptz,
    right: DataType.timestamp,
    returns: DataType.interval,
    implementation: (a: Date, b: Date) => ({
      seconds: (a.getTime() - b.getTime()) / 1000,
    }),
  });

  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres' as const,
    entities,
    synchronize: true,
    migrationsRun: false,
    logging: false,
  });

  return ds;
}