import type { DataSource, EntityManager } from 'typeorm';
import { isPostgres } from '../lib/is-postgres.js';

/** Serializes auto snapshot creation across concurrent backend ticks/processes. */
export const SIM_AUTO_SNAPSHOT_ADVISORY_LOCK_KEY = 847263001;

export async function withAutoSnapshotCreationLock<T>(
  ds: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (isPostgres(ds)) {
    return ds.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        SIM_AUTO_SNAPSHOT_ADVISORY_LOCK_KEY,
      ]);
      return fn(manager);
    });
  }
  return ds.transaction('SERIALIZABLE', async (manager) => fn(manager));
}
