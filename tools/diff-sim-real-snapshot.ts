/**
 * CI guard: sim/real snapshot-decision-collector must stay mirrored via shared helpers.
 *
 * Convention (see packages/core/src/snapshot/decision-collector-shared.ts):
 *   fix(sim): ... [mirror: real/snapshot-decision-collector.ts]
 *   fix(real): ... [mirror: simulation/snapshot-decision-collector.ts]
 *
 * Exit 0 = OK, exit 1 = divergence / missing shared import.
 *
 * Usage: npx tsx tools/diff-sim-real-snapshot.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const simPath = join(
  root,
  'packages/core/src/simulation/snapshot-decision-collector.ts',
);
const realPath = join(root, 'packages/core/src/real/snapshot-decision-collector.ts');
const sharedPath = join(
  root,
  'packages/core/src/snapshot/decision-collector-shared.ts',
);

const SHARED_IMPORT = '../snapshot/decision-collector-shared.js';
const FORBIDDEN_LOCAL_DEFS = [
  /function\s+toExitAttemptDto\s*\(/,
  /function\s+toMoveEventDto\s*\(/,
  /function\s+incrementCount\s*\(/,
  /function\s+buildPositionBreakdown\s*\(/,
  /function\s+truncateEvents\s*</,
  /export\s+const\s+SNAPSHOT_DECISION_MAX_EVENTS\s*=/,
  /export\s+const\s+SNAPSHOT_DECISION_MAX_JSON_BYTES\s*=/,
];

const REQUIRED_SHARED_EXPORTS = [
  'toExitAttemptDto',
  'toMoveEventDto',
  'incrementCount',
  'buildPositionBreakdown',
  'truncateEvents',
  'SNAPSHOT_DECISION_MAX_EVENTS',
  'SNAPSHOT_DECISION_MAX_JSON_BYTES',
];

function fail(msg: string): never {
  console.error(`[diff-sim-real-snapshot] FAIL: ${msg}`);
  process.exit(1);
}

function checkCollector(label: string, source: string): void {
  if (!source.includes(SHARED_IMPORT)) {
    fail(`${label} must import from ${SHARED_IMPORT}`);
  }
  for (const pattern of FORBIDDEN_LOCAL_DEFS) {
    if (pattern.test(source)) {
      fail(
        `${label} redefines shared helper (${pattern}): move it to decision-collector-shared.ts`,
      );
    }
  }
}

function main(): void {
  const shared = readFileSync(sharedPath, 'utf8');
  const sim = readFileSync(simPath, 'utf8');
  const real = readFileSync(realPath, 'utf8');

  for (const name of REQUIRED_SHARED_EXPORTS) {
    if (!shared.includes(name)) {
      fail(`decision-collector-shared.ts missing export/symbol: ${name}`);
    }
  }

  checkCollector('simulation/snapshot-decision-collector.ts', sim);
  checkCollector('real/snapshot-decision-collector.ts', real);

  // Both must re-export constants for archive/service consumers.
  for (const [label, src] of [
    ['sim', sim],
    ['real', real],
  ] as const) {
    if (!src.includes('SNAPSHOT_DECISION_MAX_EVENTS')) {
      fail(`${label} collector must re-export SNAPSHOT_DECISION_MAX_EVENTS`);
    }
    if (!src.includes('SNAPSHOT_DECISION_MAX_JSON_BYTES')) {
      fail(`${label} collector must re-export SNAPSHOT_DECISION_MAX_JSON_BYTES`);
    }
  }

  console.log(
    '[diff-sim-real-snapshot] OK — both collectors import shared helpers; no local redefinition.',
  );
  console.log(
    '  Mirror commit convention: fix(sim|real): ... [mirror: <other>/snapshot-decision-collector.ts]',
  );
}

main();
