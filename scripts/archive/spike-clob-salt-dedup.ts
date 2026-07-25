/**
 * ADR-031 gate: deterministic CLOB salt deduplication spike.
 * Must pass before enabling real_trading_enabled.
 */
import { createHash } from 'node:crypto';

function deterministicSalt(orderSignalId: string): string {
  const hash = createHash('sha256').update(orderSignalId).digest('hex');
  return BigInt(`0x${hash.slice(0, 16)}`).toString();
}

const uniqueIds = [
  'move123::sim::COPY_OPEN::BUY',
  '42::sim::TP::1',
  '99::real::SL::2',
];

const salts = new Map<string, string>();
for (const id of uniqueIds) {
  const salt = deterministicSalt(id);
  if (salts.has(salt)) {
    console.error(`FAIL: collision between ids for salt ${salt}`);
    process.exit(1);
  }
  salts.set(salt, id);
}

const id1 = deterministicSalt('test-signal-1');
const id2 = deterministicSalt('test-signal-1');

if (id1 !== id2) {
  console.error('FAIL: salt not deterministic');
  process.exit(1);
}

console.log('PASS: spike-clob-salt-dedup');
console.log(`  sample salt: ${id1}`);
