import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const API = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const USER = process.env.ADMIN_USERNAME ?? 'admin';
const PASS = process.env.ADMIN_PASSWORD ?? 'changeme';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`login failed ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

async function main() {
  console.log('=== LIVE AUDIT /api/algo/markets-prices ===');
  console.log('API base:', API);
  console.log('Time:', new Date().toISOString());

  // Health check
  try {
    const health = await fetch(`${API}/health`);
    console.log('Backend /health:', health.status, await health.text());
  } catch (err) {
    console.error('Backend unreachable:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let token: string;
  try {
    token = await login();
    console.log('JWT login: OK');
  } catch (err) {
    console.error('JWT login failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const res = await fetch(`${API}/api/algo/markets-prices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('\nGET /api/algo/markets-prices status:', res.status);
  if (!res.ok) {
    console.error('Body:', await res.text());
    process.exit(1);
  }

  const payload = (await res.json()) as {
    live: Array<{
      conditionId: string;
      question: string | null;
      cryptoSymbol: string | null;
      interval: string | null;
      enabled: boolean;
      closed: boolean;
      resolved: boolean;
      startDate: string | null;
      endDate: string | null;
      upPrice: number | null;
      downPrice: number | null;
    }>;
    future: Array<{
      conditionId: string;
      question: string | null;
      cryptoSymbol: string | null;
      interval: string | null;
      startDate: string | null;
      upPrice: number | null;
      downPrice: number | null;
    }>;
  };

  console.log(`\nAPI live count: ${payload.live.length}`);
  for (const m of payload.live) {
    console.log(
      `  LIVE  ${m.cryptoSymbol} ${m.interval} | ${m.question?.slice(0, 55)} | closed=${m.closed} resolved=${m.resolved} up=${m.upPrice} down=${m.downPrice}`,
    );
  }

  console.log(`\nAPI future count: ${payload.future.length}`);
  const now = Date.now();
  for (const m of payload.future) {
    const startMs = m.startDate ? new Date(m.startDate).getTime() : null;
    const deltaSec = startMs != null ? Math.round((startMs - now) / 1000) : null;
    console.log(
      `  FUTURE ${m.cryptoSymbol} ${m.interval} | starts in ${deltaSec}s | ${m.question?.slice(0, 55)} | up=${m.upPrice} down=${m.downPrice}`,
    );
  }

  const c = await pool.connect();
  try {
    const enabled = await c.query(`
      SELECT crypto_symbol, interval, enabled, question, condition_id
      FROM algo_market_selections WHERE enabled = true ORDER BY crypto_symbol
    `);
    console.log(`\nDB enabled selections: ${enabled.rows.length}`);
    for (const r of enabled.rows) {
      console.log(`  DB    ${r.crypto_symbol} ${r.interval} | ${r.question?.slice(0, 55)}`);
    }

    const rules = await c.query(`
      SELECT COUNT(*)::int AS n FROM algo_auto_track_rules WHERE enabled = true
    `);
    console.log(`\nDB enabled auto-track rules: ${rules.rows[0].n}`);

    const apiLiveIds = new Set(payload.live.map((m) => m.conditionId));
    const dbOnly = enabled.rows.filter((r) => !apiLiveIds.has(r.condition_id));
    if (dbOnly.length > 0) {
      console.log('\n⚠ DB selections NOT returned by API live:');
      for (const r of dbOnly) console.log(`  - ${r.condition_id} ${r.question}`);
    }

    if (payload.live.length === 0 && enabled.rows.length > 0) {
      console.log('\n❌ DIAG: DB has enabled selections but API live=[] → frontend shows empty surveillés');
    } else if (payload.live.length > 0) {
      console.log('\n✓ Marchés surveillés should be visible in UI');
    }

    if (payload.future.length === 0) {
      console.log('\nℹ Marchés futurs empty: next windows may start >10min away or discovery returned no startDate');
    } else {
      console.log('\n✓ Marchés futurs should be visible in UI');
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
