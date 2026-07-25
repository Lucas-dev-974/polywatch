import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch' });

async function main() {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT id, condition_id, recorded_at, up_price, down_price
      FROM algo_price_ticks
      WHERE condition_id = '0x7d9f61c91ed3bf55c67fa86dfd9941d3fce56b964d245741d60f077d77e98e46'
      ORDER BY recorded_at DESC
      LIMIT 5
    `);
    console.log('=== Derniers ticks algo ===');
    rows.rows.forEach((r: any) => {
      const t = r.recorded_at instanceof Date ? r.recorded_at.getTime() : Date.parse(r.recorded_at);
      console.log(JSON.stringify({
        id: r.id,
        recorded_at: String(r.recorded_at),
        recorded_at_type: typeof r.recorded_at,
        t,
        t_valid: Number.isFinite(t),
        up_price: r.up_price,
        down_price: r.down_price,
      }));
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
