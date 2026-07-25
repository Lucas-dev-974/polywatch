import { createDataSource, initializeDataSource } from '@polywatch/core';

async function main() {
  const ds = await initializeDataSource(createDataSource());
  const tables = await ds.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('Tables:', JSON.stringify(tables.map((r: any) => r.table_name)));
  const hasMarketPrice = tables.some((r: any) => r.table_name === 'market_price_ticks');
  console.log('market_price_ticks exists:', hasMarketPrice);
  await ds.destroy();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
