import { loadMonorepoEnv } from './config/env.js';
import {
  createMigratorDataSource,
  initializeDataSource,
} from './database/data-source.js';
import { backfillAppliedMigrations } from './migration-backfill.js';
import { seedDefaults } from './seed/defaults.js';

loadMonorepoEnv();

/**
 * Migrate the database schema via TypeORM migrations (not synchronize).
 *
 * On databases originally created via `synchronize: true`, the TypeORM
 * `migrations` tracking table is empty. We first backfill it for migrations
 * whose effects are already present, then run pending migrations normally.
 * See migration-backfill.ts for details.
 */
async function main() {
  const ds = createMigratorDataSource();
  await initializeDataSource(ds);
  await backfillAppliedMigrations(ds);
  await ds.runMigrations();
  await seedDefaults(ds);
  console.log(`Database migrated`);
  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});