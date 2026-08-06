import type { DataSource } from 'typeorm';

export function isPostgres(ds: Pick<DataSource, 'options'>): boolean {
  return ds.options.type === 'postgres';
}
