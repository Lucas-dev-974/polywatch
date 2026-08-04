const { Client } = require('pg');
const Redis = require('ioredis');

async function main() {
  const pg = new Client({
    connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
  });
  await pg.connect();

  const before = await pg.query('SELECT id, crypto_algo_enabled FROM crypto_config');
  console.log('before:', JSON.stringify(before.rows));

  await pg.query('UPDATE crypto_config SET crypto_algo_enabled = false WHERE id = 1');

  const after = await pg.query('SELECT id, crypto_algo_enabled FROM crypto_config');
  console.log('after:', JSON.stringify(after.rows));

  const redis = new Redis('redis://localhost:6379');
  const receivers = await redis.publish('config-changed', JSON.stringify({ kind: 'crypto', source: 'manual-disable', at: new Date().toISOString() }));
  console.log('config-changed published, receivers:', receivers);
  redis.disconnect();

  await pg.end();
  console.log('crypto-algo DISABLED');
}
main().catch(e => { console.error(e); process.exit(1); });
