#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Vérifie pourquoi redeemPositions a payé 0.
 *
 * Compare l'asset_id détenu (CLOB) avec le positionId que le contrat CTF
 * calcule pour (collateral, conditionId, indexSet) et lit le payout vector
 * on-chain pour savoir si la condition est résolue et quel slot a gagné.
 */
import { ethers } from 'ethers';
import { loadMonorepoEnv } from '../../packages/core/src/config/env.js';
import { POLYGON_CLOB_CONTRACTS_V2 } from '../../packages/core/src/polymarket/clob-contracts.js';
import { createRecoveryPool, createPolygonProvider } from './shared.js';

loadMonorepoEnv();

const CTF_ABI = [
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
  'function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)',
  'function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
];

// Wrapped collateral utilisé par le NegRiskAdapter
const NEG_RISK_WCOL = '0x3A3BD7bb9528E159577F7C2e685CC81A765002E2';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

const DEPOSIT = '0xB6ce54F3290dae58C4334Ae6B326C0AA801645FB';

async function main() {
  const pool = createRecoveryPool();
  const { rows } = await pool.query(
    `SELECT p.asset_id, p.condition_id, m.token_id_yes, m.token_id_no,
            m.winning_token_id, COALESCE(m.neg_risk, false) AS neg_risk
     FROM copied_positions p
     JOIN markets m ON m.condition_id = p.condition_id
     WHERE p.id = 22441`,
  );
  await pool.end();
  const pos = rows[0] as {
    asset_id: string;
    condition_id: string;
    token_id_yes: string | null;
    token_id_no: string | null;
    winning_token_id: string | null;
    neg_risk: boolean;
  };

  console.log('=== DONNÉES BASE ===');
  console.log({
    condition_id: pos.condition_id,
    asset_id: pos.asset_id,
    token_id_yes: pos.token_id_yes,
    token_id_no: pos.token_id_no,
    winning_token_id: pos.winning_token_id,
    neg_risk_db: pos.neg_risk,
  });

  const provider = createPolygonProvider();
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_ABI,
    provider,
  );

  const conditionId = pos.condition_id;

  console.log('\n=== RÉSOLUTION ON-CHAIN (payout vector) ===');
  const slotCount = (await ctf.getOutcomeSlotCount(conditionId)) as bigint;
  const denominator = (await ctf.payoutDenominator(conditionId)) as bigint;
  console.log({ outcome_slots: slotCount.toString(), payout_denominator: denominator.toString() });
  if (denominator === 0n) {
    console.log('>>> Condition NON résolue on-chain (denominator = 0) — redeem paierait 0 ou revert.');
  } else {
    for (let i = 0; i < Number(slotCount); i++) {
      const num = (await ctf.payoutNumerators(conditionId, i)) as bigint;
      console.log(`payout_numerator[slot ${i}] = ${num.toString()}${num > 0n ? '  <-- slot gagnant' : ''}`);
    }
  }

  console.log('\n=== POSITION IDS CALCULÉS PAR LE CTF ===');
  const collaterals: Array<[string, string]> = [
    ['pUSD (utilisé par le redeem)', POLYGON_CLOB_CONTRACTS_V2.collateral],
    ['USDC.e', USDC_E],
    ['USDC natif', USDC_NATIVE],
    ['WCOL (NegRiskAdapter)', NEG_RISK_WCOL],
  ];

  const heldAssetId = BigInt(pos.asset_id);

  for (const [label, collateral] of collaterals) {
    for (const indexSet of [1n, 2n]) {
      const collectionId = (await ctf.getCollectionId(
        ethers.ZeroHash,
        conditionId,
        indexSet,
      )) as string;
      const positionId = (await ctf.getPositionId(collateral, collectionId)) as bigint;
      const match = positionId === heldAssetId;
      const matchYes = pos.token_id_yes && positionId === BigInt(pos.token_id_yes);
      const matchNo = pos.token_id_no && positionId === BigInt(pos.token_id_no);
      const tags = [
        match ? 'MATCH asset détenu' : null,
        matchYes ? 'MATCH token_id_yes' : null,
        matchNo ? 'MATCH token_id_no' : null,
      ].filter(Boolean);
      console.log(
        `${label} | indexSet=${indexSet}: ${positionId.toString().slice(0, 16)}…${tags.length ? '  <-- ' + tags.join(', ') : ''}`,
      );
      if (match || matchYes || matchNo) {
        const bal = (await ctf.balanceOf(DEPOSIT, positionId)) as bigint;
        console.log(`    balance deposit = ${bal.toString()}`);
      }
    }
  }

  console.log('\n=== SOLDE DE L\'ASSET DÉTENU ===');
  const heldBal = (await ctf.balanceOf(DEPOSIT, heldAssetId)) as bigint;
  console.log({ asset_id_held_balance: heldBal.toString() });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
