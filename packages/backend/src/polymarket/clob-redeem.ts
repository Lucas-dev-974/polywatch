import { ethers } from 'ethers';
import type { ClobCredentials, WinningOutcome } from '@polywatch/core';
import { POLYGON_CLOB_CONTRACTS_V2 } from '@polywatch/core';
import { createPolygonProvider } from './polygon.js';
import { createRelayClient, waitForTxHash } from './relayer-client.js';
import { buildDepositWalletDeadline } from './deposit-wallet-signing.js';
import { decrypt } from '../crypto/encryption.js';
import {
  detectCollateralForAsset,
  fetchConditionPayoutDenominator,
  fetchCtfShareBalance,
  parseRedemptionPayoutFromLogs,
  type DetectedCollateral,
} from './collateral-detection.js';
import { buildWrapDepositWalletCalls } from './collateral-ramp.js';

export type RedemptionWalletMode = 'deposit' | 'safe' | 'proxy';

const CTF_ABI_REDEEM = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets)',
];

const NEG_RISK_ADAPTER_ABI = [
  'function redeemPositions(bytes32 conditionId, uint256[] calldata amounts)',
];

export interface RedeemOnChainInput {
  conditionId: string;
  winningOutcome: WinningOutcome;
  /** Share quantity in raw 6-decimal units (same scale as CTF ERC1155 balances). */
  quantityRaw: string;
  negRisk: boolean;
  /** The redemption wallet mode (deposit, safe, proxy). */
  mode: RedemptionWalletMode;
  /** Signer private key (encrypted) — required for all modes. */
  signerPkEnc: string | null;
  /**
   * Held CTF token id — required for non-negRisk markets so the correct
   * collateral (pUSD / USDC.e / USDC) is used in redeemPositions.
   */
  assetId?: string;
}

export interface RedeemOnChainResult {
  txHash: string;
  success: boolean;
  amountRedeemedRaw: string;
  error?: string;
  /** Collateral used for CTF redeem (null for negRisk). */
  collateralSlug?: string | null;
  /** True when USDC.e payout was wrapped to pUSD after redeem. */
  wrappedToPusd?: boolean;
  wrapTxHash?: string;
  wrapError?: string;
}

export function partitionIndexSet(outcome: WinningOutcome): bigint[] {
  return outcome === 'YES' ? [1n] : [2n];
}

export function negRiskRedeemAmounts(
  outcome: WinningOutcome,
  quantityRaw: bigint,
): bigint[] {
  return outcome === 'YES' ? [quantityRaw, 0n] : [0n, quantityRaw];
}

export function normalizeConditionIdBytes(conditionId: string): string {
  const hex = conditionId.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('invalid_condition_id');
  }
  return `0x${hex}`;
}

export function encodeCtfRedeemCalldata(input: {
  conditionId: string;
  winningOutcome: WinningOutcome;
  /** Required — wrong collateral yields payout 0 without revert. */
  collateralAddress: string;
  /** Optional override; defaults from winningOutcome. */
  indexSet?: 1 | 2;
}): string {
  const indexSets =
    input.indexSet != null
      ? [BigInt(input.indexSet)]
      : partitionIndexSet(input.winningOutcome);
  const iface = new ethers.Interface(CTF_ABI_REDEEM);
  return iface.encodeFunctionData('redeemPositions', [
    input.collateralAddress,
    ethers.ZeroHash,
    normalizeConditionIdBytes(input.conditionId),
    indexSets,
  ]);
}

export function encodeNegRiskRedeemCalldata(input: {
  conditionId: string;
  winningOutcome: WinningOutcome;
  quantityRaw: bigint;
}): string {
  const iface = new ethers.Interface(NEG_RISK_ADAPTER_ABI);
  return iface.encodeFunctionData('redeemPositions', [
    normalizeConditionIdBytes(input.conditionId),
    negRiskRedeemAmounts(input.winningOutcome, input.quantityRaw),
  ]);
}

function buildRedeemCalldata(
  input: Pick<
    RedeemOnChainInput,
    'conditionId' | 'winningOutcome' | 'negRisk' | 'quantityRaw'
  >,
  collateral: DetectedCollateral | null,
): string {
  const quantityRaw = BigInt(input.quantityRaw);
  if (input.negRisk) {
    return encodeNegRiskRedeemCalldata({
      conditionId: input.conditionId,
      winningOutcome: input.winningOutcome,
      quantityRaw,
    });
  }
  if (!collateral) {
    throw new Error('collateral_required_for_ctf_redeem');
  }
  return encodeCtfRedeemCalldata({
    conditionId: input.conditionId,
    winningOutcome: input.winningOutcome,
    collateralAddress: collateral.address,
    indexSet: collateral.indexSet,
  });
}

function getRedeemTarget(negRisk: boolean): string {
  return negRisk
    ? POLYGON_CLOB_CONTRACTS_V2.negRiskAdapter
    : POLYGON_CLOB_CONTRACTS_V2.conditionalTokens;
}

/**
 * Verify redemption from receipt logs.
 * success only when an on-chain payout event reports amount > 0.
 */
export async function verifyRedemptionReceipt(
  txHash: string,
): Promise<{ verified: boolean; amountRedeemedRaw: string }> {
  const provider = createPolygonProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error('redemption_receipt_not_found');
  }
  if (receipt.status === 0) {
    throw new Error('redemption_tx_reverted');
  }

  const parsed = parseRedemptionPayoutFromLogs(receipt.logs);
  if (parsed.payoutRaw == null) {
    return { verified: false, amountRedeemedRaw: '0' };
  }
  if (parsed.payoutRaw === 0n) {
    return { verified: false, amountRedeemedRaw: '0' };
  }
  return { verified: true, amountRedeemedRaw: parsed.payoutRaw.toString() };
}

/**
 * Redeem winning position shares on-chain via the CTF or NegRiskAdapter.
 *
 * Routes through the correct relayer method based on the wallet mode:
 * - deposit: uses `executeDepositWalletBatch` (UUPS deposit wallet)
 * - safe/proxy: uses `execute` with the appropriate `RelayerTxType`
 *
 * After a successful USDC.e redeem, automatically wraps payout → pUSD.
 */
export async function redeemOnChain(
  creds: ClobCredentials,
  depositAddress: string,
  input: RedeemOnChainInput,
): Promise<RedeemOnChainResult> {
  const quantityRaw = BigInt(input.quantityRaw);
  if (quantityRaw <= 0n) {
    throw new Error('invalid_redeem_quantity');
  }

  try {
    let collateral: DetectedCollateral | null = null;

    if (!input.negRisk) {
      if (!input.assetId?.trim()) {
        throw new Error('asset_id_required_for_ctf_redeem');
      }
      const denominator = await fetchConditionPayoutDenominator(input.conditionId);
      if (denominator === 0n) {
        throw new Error('condition_not_resolved_on_chain');
      }
      // Stop zero-payout spam: redeemPositions with empty balance still mines a tx.
      const shareBal = await fetchCtfShareBalance(depositAddress, input.assetId);
      if (shareBal <= 0n) {
        return {
          txHash: '',
          success: false,
          amountRedeemedRaw: '0',
          error: 'no_ctf_balance',
        };
      }
      collateral = await detectCollateralForAsset(
        input.conditionId,
        input.assetId,
      );
      if (!collateral) {
        throw new Error('collateral_detection_failed');
      }
    }

    const calldata = buildRedeemCalldata(input, collateral);
    const target = getRedeemTarget(input.negRisk);

    let txHash: string;

    if (input.mode === 'deposit') {
      if (!input.signerPkEnc) {
        throw new Error('signer_missing_for_deposit_redemption');
      }
      const signerPrivateKey = decrypt(input.signerPkEnc);
      const client = createRelayClient(creds, signerPrivateKey, 'deposit');
      const response = await client.executeDepositWalletBatch(
        [{ target, value: '0', data: calldata }],
        depositAddress,
        buildDepositWalletDeadline(false),
      );
      txHash = await waitForTxHash(response);
    } else {
      if (!input.signerPkEnc) {
        throw new Error('signer_missing_for_safe_proxy_redemption');
      }
      const signerPrivateKey = decrypt(input.signerPkEnc);
      const client = createRelayClient(creds, signerPrivateKey, input.mode);
      const response = await client.execute(
        [{ to: target, value: '0', data: calldata }],
        'Polywatch redeem position',
      );
      txHash = await waitForTxHash(response);
    }

    const { verified, amountRedeemedRaw } =
      await verifyRedemptionReceipt(txHash);

    if (!verified || amountRedeemedRaw === '0') {
      return {
        txHash,
        success: false,
        amountRedeemedRaw: '0',
        error: 'zero_payout',
        collateralSlug: collateral?.slug ?? null,
      };
    }

    const result: RedeemOnChainResult = {
      txHash,
      success: true,
      amountRedeemedRaw,
      collateralSlug: collateral?.slug ?? null,
    };

    if (collateral?.slug === 'USDC.e' && input.signerPkEnc) {
      const wrap = await wrapUsdcePayoutToPusd(
        creds,
        depositAddress,
        input,
        BigInt(amountRedeemedRaw),
      );
      result.wrappedToPusd = wrap.ok;
      result.wrapTxHash = wrap.txHash;
      result.wrapError = wrap.error;
    }

    return result;
  } catch (err) {
    const message = (err as Error).message ?? 'unknown_error';
    return {
      txHash: '',
      success: false,
      amountRedeemedRaw: '0',
      error: message,
    };
  }
}

async function wrapUsdcePayoutToPusd(
  creds: ClobCredentials,
  depositAddress: string,
  input: Pick<RedeemOnChainInput, 'mode' | 'signerPkEnc'>,
  amountRaw: bigint,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  if (amountRaw <= 0n || !input.signerPkEnc) {
    return { ok: false, error: 'wrap_skipped' };
  }
  try {
    const signerPrivateKey = decrypt(input.signerPkEnc);
    const client = createRelayClient(creds, signerPrivateKey, input.mode);
    const calls = buildWrapDepositWalletCalls(depositAddress, amountRaw);

    if (input.mode === 'deposit') {
      const response = await client.executeDepositWalletBatch(
        calls,
        depositAddress,
        buildDepositWalletDeadline(false),
      );
      const wrapTxHash = await waitForTxHash(response);
      return { ok: true, txHash: wrapTxHash };
    }

    const response = await client.execute(
      calls.map((c) => ({ to: c.target, value: c.value, data: c.data })),
      'Polywatch wrap USDC.e to pUSD',
    );
    const wrapTxHash = await waitForTxHash(response);
    return { ok: true, txHash: wrapTxHash };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? 'wrap_failed',
    };
  }
}
