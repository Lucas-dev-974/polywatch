import type { DataSource, EntityManager } from 'typeorm';
import { isPostgres } from '../lib/is-postgres.js';

/** Serializes real period rotation across concurrent requests/processes. */
export const REAL_ROTATE_ADVISORY_LOCK_KEY = 847263101;

/** Serializes real auto snapshot creation across concurrent backend ticks/processes. */
export const REAL_AUTO_SNAPSHOT_ADVISORY_LOCK_KEY = 847263102;

export async function withRealRotateLock<T>(
  ds: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (isPostgres(ds)) {
    return ds.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        REAL_ROTATE_ADVISORY_LOCK_KEY,
      ]);
      return fn(manager);
    });
  }
  return ds.transaction('SERIALIZABLE', async (manager) => fn(manager));
}

export async function withRealAutoSnapshotCreationLock<T>(
  ds: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (isPostgres(ds)) {
    return ds.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        REAL_AUTO_SNAPSHOT_ADVISORY_LOCK_KEY,
      ]);
      return fn(manager);
    });
  }
  return ds.transaction('SERIALIZABLE', async (manager) => fn(manager));
}
