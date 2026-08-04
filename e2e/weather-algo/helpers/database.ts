import {
  createTestDataSource as createPgMemDataSource,
  initializeDataSource,
  seedDefaults,
  type DataSource,
} from '@polywatch/core';

export async function createTestDataSource(): Promise<DataSource> {
  const ds = createPgMemDataSource();
  await initializeDataSource(ds);
  await seedDefaults(ds);
  return ds;
}
