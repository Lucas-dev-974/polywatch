import { ethers } from 'ethers';
import type { DepositWalletCall } from '@polymarket/builder-relayer-client';
import { POLYGON_CLOB_CONTRACTS_V2 } from '@polywatch/core';
import type { ClobCredentials } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';
import { createPolygonProvider } from './polygon.js';
import { createRelayClient, waitForTxHash, RelayerWithdrawMode } from './relayer-client.js';
import { buildDepositWalletDeadline } from './deposit-wallet-signing.js';

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
];
const ERC20_ALLOWANCE_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
];
// CTF is ERC-1155; setApprovalForAll / isApprovedForAll share this signature.
const ERC1155_APPROVE_ALL_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
];
const ERC1155_IS_APPROVED_ABI = [
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
];

const erc20Iface = new ethers.Interface(ERC20_APPROVE_ABI);
const erc1155Iface = new ethers.Interface(ERC1155_APPROVE_ALL_ABI);

const MAX_UINT256 = ethers.MaxUint256;

const PUSD_TOKEN = POLYGON_CLOB_CONTRACTS_V2.collateral;
const CTF_TOKEN = POLYGON_CLOB_CONTRACTS_V2.conditionalTokens;
const EXCHANGE_V2 = POLYGON_CLOB_CONTRACTS_V2.exchangeV2;
const NEG_RISK_EXCHANGE_V2 = POLYGON_CLOB_CONTRACTS_V2.negRiskExchangeV2;
const NEG_RISK_ADAPTER = POLYGON_CLOB_CONTRACTS_V2.negRiskAdapter;

export interface ApprovalStatus {
  /** pUSD → CTF — splitPosition only; not required to post a CLOB order. */
  pusdToCtf: boolean;
  /** pUSD → Exchange V2 — required for standard-market BUY matching. */
  pusdToExchange: boolean;
  /** pUSD → NegRisk Exchange V2 — not the weather/neg-risk matcher spender. */
  pusdToNegRisk: boolean;
  /** pUSD → NegRiskAdapter — required for BUY matching on neg-risk markets (weather). */
  pusdToAdapter: boolean;
  /** CTF → Exchange V2 — required for standard-market SELL. */
  ctfToExchange: boolean;
  /** CTF → NegRisk Exchange V2 — not the weather/neg-risk matcher operator. */
  ctfToNegRisk: boolean;
  /** CTF → NegRiskAdapter — required for SELL / redeem on neg-risk markets. */
  ctfToAdapter: boolean;
}

export type ApprovalFlag = keyof ApprovalStatus;
export type ClobOrderSide = 'BUY' | 'SELL';
export type ClobOrderKind =
  | 'standard_buy'
  | 'standard_sell'
  | 'neg_risk_buy'
  | 'neg_risk_sell';

export interface EnsureApprovalsResult {
  needed: ApprovalStatus;
  required: readonly ApprovalFlag[];
  txHash: string | null;
}

/**
 * Minimum on-chain CLOB allowances to *match* that order.
 *
 * Standard BUY: Exchange V2 pulls pUSD.
 * Standard SELL: Exchange V2 is the CTF operator.
 * Neg-risk / weather BUY: NegRiskAdapter pulls pUSD (CLOB matcher spender).
 * Neg-risk / weather SELL: NegRiskAdapter is the CTF operator (also redeem).
 *
 * Intentionally omitted: pusdToCtf (split), pusdToNegRisk / ctfToNegRisk
 * (NegRisk Exchange V2 — not the matcher spender for these orders).
 */
export function requiredApprovalFlags(
  kind: ClobOrderKind,
): readonly ApprovalFlag[] {
  switch (kind) {
    case 'standard_buy':
      return ['pusdToExchange'];
    case 'standard_sell':
      return ['ctfToExchange'];
    case 'neg_risk_buy':
      return ['pusdToAdapter'];
    case 'neg_risk_sell':
      return ['ctfToAdapter'];
  }
}

export function resolveClobOrderKind(input: {
  negRisk: boolean;
  side: ClobOrderSide;
}): ClobOrderKind {
  if (input.negRisk) {
    return input.side === 'BUY' ? 'neg_risk_buy' : 'neg_risk_sell';
  }
  return input.side === 'BUY' ? 'standard_buy' : 'standard_sell';
}

export function allClobApprovalsGranted(
  status: ApprovalStatus,
  required: readonly ApprovalFlag[],
): boolean {
  return required.every((flag) => status[flag]);
}

function encodePusdApprove(spender: string): string {
  return erc20Iface.encodeFunctionData('approve', [spender, MAX_UINT256]);
}

function encodeCtfApproveAll(operator: string): string {
  return erc1155Iface.encodeFunctionData('setApprovalForAll', [operator, true]);
}

const APPROVAL_CALLS: Record<ApprovalFlag, () => DepositWalletCall> = {
  pusdToCtf: () => ({
    target: PUSD_TOKEN,
    value: '0',
    data: encodePusdApprove(CTF_TOKEN),
  }),
  pusdToExchange: () => ({
    target: PUSD_TOKEN,
    value: '0',
    data: encodePusdApprove(EXCHANGE_V2),
  }),
  pusdToNegRisk: () => ({
    target: PUSD_TOKEN,
    value: '0',
    data: encodePusdApprove(NEG_RISK_EXCHANGE_V2),
  }),
  pusdToAdapter: () => ({
    target: PUSD_TOKEN,
    value: '0',
    data: encodePusdApprove(NEG_RISK_ADAPTER),
  }),
  ctfToExchange: () => ({
    target: CTF_TOKEN,
    value: '0',
    data: encodeCtfApproveAll(EXCHANGE_V2),
  }),
  ctfToNegRisk: () => ({
    target: CTF_TOKEN,
    value: '0',
    data: encodeCtfApproveAll(NEG_RISK_EXCHANGE_V2),
  }),
  ctfToAdapter: () => ({
    target: CTF_TOKEN,
    value: '0',
    data: encodeCtfApproveAll(NEG_RISK_ADAPTER),
  }),
};

/** Relayer batch for *required* flags that are not yet granted. */
export function buildMissingApprovalCalls(
  status: ApprovalStatus,
  required: readonly ApprovalFlag[],
): DepositWalletCall[] {
  const calls: DepositWalletCall[] = [];
  for (const flag of required) {
    if (!status[flag]) {
      calls.push(APPROVAL_CALLS[flag]());
    }
  }
  return calls;
}

/**
 * Check on-chain whether the required CLOB approvals are already set for the
 * given deposit wallet on the V2 contracts.
 */
export async function checkClobApprovals(
  depositAddress: string,
): Promise<ApprovalStatus> {
  const provider = createPolygonProvider();

  const pusd = new ethers.Contract(PUSD_TOKEN, ERC20_ALLOWANCE_ABI, provider);
  const ctf = new ethers.Contract(CTF_TOKEN, ERC1155_IS_APPROVED_ABI, provider);

  const [
    allowanceCtf,
    allowanceEx,
    allowanceNegRisk,
    allowanceAdapter,
    approvedEx,
    approvedNegRisk,
    approvedAdapter,
  ] = await Promise.all([
    pusd.allowance(depositAddress, CTF_TOKEN) as Promise<bigint>,
    pusd.allowance(depositAddress, EXCHANGE_V2) as Promise<bigint>,
    pusd.allowance(depositAddress, NEG_RISK_EXCHANGE_V2) as Promise<bigint>,
    pusd.allowance(depositAddress, NEG_RISK_ADAPTER) as Promise<bigint>,
    ctf.isApprovedForAll(depositAddress, EXCHANGE_V2) as Promise<boolean>,
    ctf.isApprovedForAll(depositAddress, NEG_RISK_EXCHANGE_V2) as Promise<boolean>,
    ctf.isApprovedForAll(depositAddress, NEG_RISK_ADAPTER) as Promise<boolean>,
  ]);

  const sufficient = (value: bigint) => value >= MAX_UINT256 / 2n;

  return {
    pusdToCtf: sufficient(allowanceCtf),
    pusdToExchange: sufficient(allowanceEx),
    pusdToNegRisk: sufficient(allowanceNegRisk),
    pusdToAdapter: sufficient(allowanceAdapter),
    ctfToExchange: approvedEx,
    ctfToNegRisk: approvedNegRisk,
    ctfToAdapter: approvedAdapter,
  };
}

/**
 * Ensure the CLOB V2 approvals *required for this order* exist on the deposit
 * wallet. Unrelated spenders are neither required nor granted.
 *
 * 1. Checks on-chain status (read-only, cheap).
 * 2. If any *required* approval is missing, submits a single relayer batch
 *    with those calls only. Returns the tx hash (or null if already present).
 */
export async function ensureClobApprovals(
  creds: ClobCredentials,
  depositAddress: string,
  required: readonly ApprovalFlag[],
): Promise<EnsureApprovalsResult> {
  if (required.length === 0) {
    throw new Error('required_approvals_empty');
  }

  const needed = await checkClobApprovals(depositAddress);

  if (allClobApprovalsGranted(needed, required)) {
    return { needed, required, txHash: null };
  }

  const calls = buildMissingApprovalCalls(needed, required);

  // Deposit-wallet batch requires a signer on the RelayClient.
  const signerPrivateKey = creds.signerPkEnc ? decrypt(creds.signerPkEnc) : null;
  if (!signerPrivateKey) {
    throw new Error('signer_missing: signerPkEnc required for deposit wallet approvals');
  }
  const client = createRelayClient(creds, signerPrivateKey, 'deposit' as RelayerWithdrawMode);
  const response = await client.executeDepositWalletBatch(
    calls,
    depositAddress,
    buildDepositWalletDeadline(false),
  );
  const txHash = await waitForTxHash(response);

  // Post-submission verification: wait for the tx receipt and re-check
  // only the required flags for this order.
  if (txHash) {
    const provider = createPolygonProvider();
    const receipt = await provider.waitForTransaction(txHash, 1, 60_000);
    if (receipt?.status !== 1) {
      throw new Error(`approval tx reverted: ${txHash}`);
    }

    const postCheck = await checkClobApprovals(depositAddress);
    if (!allClobApprovalsGranted(postCheck, required)) {
      throw new Error('approvals still missing after on-chain submission');
    }
  }

  return { needed, required, txHash };
}