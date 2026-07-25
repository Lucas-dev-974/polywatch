#!/usr/bin/env node
/**
 * CMP-1 — Manual on-chain redemption validation helper.
 *
 * Prerequisites:
 * - Backend + worker running with real trading configured
 * - A resolved market with winning CTF shares in the deposit wallet
 * - POLYGON_RPC_URL, builder credentials, and encrypted signer configured
 *
 * Usage:
 *   node scripts/validate-redemption-onchain.mjs \
 *     --condition-id 0x... --outcome YES --asset-id 123... --quantity 1
 *
 * This script calls POST /api/internal/redeem (same path as the worker) and
 * prints the relayer response. Verify the transaction hash on Polygonscan.
 */
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  options: {
    'condition-id': { type: 'string' },
    outcome: { type: 'string' },
    'asset-id': { type: 'string' },
    quantity: { type: 'string', default: '1' },
    'backend-url': { type: 'string', default: process.env.BACKEND_URL ?? 'http://127.0.0.1:3000' },
    'service-token': { type: 'string', default: process.env.SERVICE_TOKEN ?? '' },
    'neg-risk': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage: node scripts/validate-redemption-onchain.mjs \\
  --condition-id 0x... --outcome YES|NO --asset-id <tokenId> [--quantity 1] [--neg-risk]

Environment:
  BACKEND_URL     default http://127.0.0.1:3000
  SERVICE_TOKEN   required (same as worker internal API)
`);
  process.exit(0);
}

const conditionId = values['condition-id'] ?? positionals[0];
const winningOutcome = (values.outcome ?? positionals[1] ?? '').toUpperCase();
const assetId = values['asset-id'] ?? positionals[2];
const quantity = values.quantity ?? '1';
const serviceToken = values['service-token'];
const negRisk = values['neg-risk'] ?? false;

if (!conditionId || !winningOutcome || (winningOutcome !== 'YES' && winningOutcome !== 'NO')) {
  console.error('Missing --condition-id and --outcome YES|NO');
  process.exit(1);
}
if (!negRisk && !assetId) {
  console.error('Missing --asset-id (required for non-negRisk CTF markets)');
  process.exit(1);
}
if (!serviceToken) {
  console.error('Missing SERVICE_TOKEN (or --service-token)');
  process.exit(1);
}

// CTF shares use 6 decimals (same scale as pUSD raw units).
const quantityRaw = String(Math.round(Number(quantity) * 1_000_000));

const url = `${values['backend-url'].replace(/\/$/, '')}/api/internal/redeem`;
console.log('Calling', url);
console.log({ conditionId, winningOutcome, quantityRaw, negRisk, assetId });

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Service-Token': serviceToken,
  },
  body: JSON.stringify({
    conditionId,
    winningOutcome,
    quantityRaw,
    negRisk,
    assetId,
  }),
});

const body = await res.json().catch(() => ({}));
console.log('Status:', res.status);
console.log(JSON.stringify(body, null, 2));

if (!res.ok) {
  process.exit(1);
}

if (body.txHash || body.transactionHash) {
  console.log('\nVerify on Polygonscan:', body.txHash ?? body.transactionHash);
}
