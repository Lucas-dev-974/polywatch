import { ethers } from 'ethers';
import {
  COLLATERAL_TOKEN_DEFINITIONS,
  POLYGON_CLOB_CONTRACTS_V2,
  type CollateralTokenSlug,
} from '@polywatch/core';
import { createPolygonProvider } from './polygon.js';

const CTF_POSITION_ABI = [
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
];

const PAYOUT_REDEMPTION_ABI = [
  'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
];

const REDEEMED_ABI = [
  'event Redeemed(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, bytes32 indexed indexedConditionId, address indexed caller, uint256[] indexSets, uint256[] redemptions)',
];

export interface DetectedCollateral {
  slug: CollateralTokenSlug;
  address: string;
  /** 1 = YES (slot 0), 2 = NO (slot 1) */
  indexSet: 1 | 2;
}

/**
 * Resolve the ERC20 collateral that indexes the held CTF position id.
 * Wrong collateral → redeemPositions succeeds with payout 0 (no revert).
 */
export async function detectCollateralForAsset(
  conditionId: string,
  assetId: string,
  provider: ethers.Provider = createPolygonProvider(),
): Promise<DetectedCollateral | null> {
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_POSITION_ABI,
    provider,
  );
  const held = BigInt(assetId);

  for (const token of COLLATERAL_TOKEN_DEFINITIONS) {
    for (const indexSet of [1, 2] as const) {
      const collectionId = (await ctf.getCollectionId(
        ethers.ZeroHash,
        conditionId,
        indexSet,
      )) as string;
      const positionId = (await ctf.getPositionId(
        token.address,
        collectionId,
      )) as bigint;
      if (positionId === held) {
        return {
          slug: token.slug,
          address: token.address,
          indexSet,
        };
      }
    }
  }
  return null;
}

export async function fetchConditionPayoutDenominator(
  conditionId: string,
  provider: ethers.Provider = createPolygonProvider(),
): Promise<bigint> {
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_POSITION_ABI,
    provider,
  );
  return (await ctf.payoutDenominator(conditionId)) as bigint;
}

export async function fetchCtfShareBalance(
  holder: string,
  assetId: string,
  provider: ethers.Provider = createPolygonProvider(),
): Promise<bigint> {
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_POSITION_ABI,
    provider,
  );
  return (await ctf.balanceOf(holder, assetId)) as bigint;
}

export interface ParsedRedemptionPayout {
  payoutRaw: bigint | null;
  source: 'PayoutRedemption' | 'Redeemed' | null;
}

/**
 * Extract on-chain redemption payout from a mined receipt.
 * Prefers PayoutRedemption.payout; falls back to sum(Redeemed.redemptions).
 * Returns payoutRaw=0n when an event reports zero — never invents quantity.
 */
export function parseRedemptionPayoutFromLogs(
  logs: ReadonlyArray<{ topics: readonly string[]; data: string }>,
): ParsedRedemptionPayout {
  const payoutIface = new ethers.Interface(PAYOUT_REDEMPTION_ABI);
  const redeemedIface = new ethers.Interface(REDEEMED_ABI);

  for (const log of logs) {
    try {
      const parsed = payoutIface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === 'PayoutRedemption') {
        return {
          payoutRaw: parsed.args.payout as bigint,
          source: 'PayoutRedemption',
        };
      }
    } catch {
      // not PayoutRedemption
    }
  }

  for (const log of logs) {
    try {
      const parsed = redeemedIface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === 'Redeemed' && parsed.args.redemptions) {
        const redeemed = parsed.args.redemptions as bigint[];
        const total = redeemed.reduce((sum: bigint, v: bigint) => sum + v, 0n);
        return { payoutRaw: total, source: 'Redeemed' };
      }
    } catch {
      // not Redeemed
    }
  }

  return { payoutRaw: null, source: null };
}
