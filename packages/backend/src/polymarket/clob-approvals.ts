import { ethers } from 'ethers';
import type { DepositWalletCall } from '@polymarket/builder-relayer-client';
import { POLYGON_CLOB_CONTRACTS_V2 } from '@polywatch/core';
import type { ClobCredentials } from '@polywatch/core';
import { createPolygonProvider } from './polygon.js';
import { createBuilderRelayClient, waitForTxHash } from './relayer-client.js';
import { buildDepositWalletDeadline } from './deposit-wallet-signing.js';

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
];
const ERC20_ALLOWANCE_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
];
const ERC721_APPROVE_ALL_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
];
const ERC721_IS_APPROVED_ABI = [
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
];

const erc20Iface = new ethers.Interface(ERC20_APPROVE_ABI);
const erc721Iface = new ethers.Interface(ERC721_APPROVE_ALL_ABI);

const MAX_UINT256 = ethers.MaxUint256;

const PUSD_TOKEN = POLYGON_CLOB_CONTRACTS_V2.collateral;
const CTF_TOKEN = POLYGON_CLOB_CONTRACTS_V2.conditionalTokens;
const EXCHANGE_V2 = POLYGON_CLOB_CONTRACTS_V2.exchangeV2;
const NEG_RISK_EXCHANGE_V2 = POLYGON_CLOB_CONTRACTS_V2.negRiskExchangeV2;

export interface ApprovalStatus {
  pusdToCtf: boolean;
  pusdToExchange: boolean;
  pusdToNegRisk: boolean;
  ctfToExchange: boolean;
  ctfToNegRisk: boolean;
}

export interface EnsureApprovalsResult {
  needed: ApprovalStatus;
  txHash: string | null;
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
  const ctf = new ethers.Contract(CTF_TOKEN, ERC721_IS_APPROVED_ABI, provider);

  const [allowanceCtf, allowanceEx, allowanceNegRisk, approvedEx, approvedNegRisk] =
    await Promise.all([
      pusd.allowance(depositAddress, CTF_TOKEN) as Promise<bigint>,
      pusd.allowance(depositAddress, EXCHANGE_V2) as Promise<bigint>,
      pusd.allowance(depositAddress, NEG_RISK_EXCHANGE_V2) as Promise<bigint>,
      ctf.isApprovedForAll(depositAddress, EXCHANGE_V2) as Promise<boolean>,
      ctf.isApprovedForAll(depositAddress, NEG_RISK_EXCHANGE_V2) as Promise<boolean>,
    ]);

  const sufficient = (value: bigint) => value >= MAX_UINT256 / 2n;

  return {
    pusdToCtf: sufficient(allowanceCtf),
    pusdToExchange: sufficient(allowanceEx),
    pusdToNegRisk: sufficient(allowanceNegRisk),
    ctfToExchange: approvedEx,
    ctfToNegRisk: approvedNegRisk,
  };
}

function encodePusdApprove(spender: string): string {
  return erc20Iface.encodeFunctionData('approve', [spender, MAX_UINT256]);
}

function encodeCtfApproveAll(operator: string): string {
  return erc721Iface.encodeFunctionData('setApprovalForAll', [operator, true]);
}

/**
 * Ensure all required CLOB V2 approvals exist for the deposit wallet.
 *
 * 1. Checks on-chain status (read-only, cheap).
 * 2. If any approval is missing, submits a single relayer batch with all
 *    missing calls. Returns the tx hash (or null if all were already present).
 */
export async function ensureClobApprovals(
  creds: ClobCredentials,
  depositAddress: string,
): Promise<EnsureApprovalsResult> {
  const needed = await checkClobApprovals(depositAddress);

  if (
    needed.pusdToCtf &&
    needed.pusdToExchange &&
    needed.pusdToNegRisk &&
    needed.ctfToExchange &&
    needed.ctfToNegRisk
  ) {
    return { needed, txHash: null };
  }

  const calls: DepositWalletCall[] = [];

  if (!needed.pusdToCtf) {
    calls.push({ target: PUSD_TOKEN, value: '0', data: encodePusdApprove(CTF_TOKEN) });
  }
  if (!needed.pusdToExchange) {
    calls.push({ target: PUSD_TOKEN, value: '0', data: encodePusdApprove(EXCHANGE_V2) });
  }
  if (!needed.pusdToNegRisk) {
    calls.push({
      target: PUSD_TOKEN,
      value: '0',
      data: encodePusdApprove(NEG_RISK_EXCHANGE_V2),
    });
  }
  if (!needed.ctfToExchange) {
    calls.push({ target: CTF_TOKEN, value: '0', data: encodeCtfApproveAll(EXCHANGE_V2) });
  }
  if (!needed.ctfToNegRisk) {
    calls.push({
      target: CTF_TOKEN,
      value: '0',
      data: encodeCtfApproveAll(NEG_RISK_EXCHANGE_V2),
    });
  }

  const client = createBuilderRelayClient(creds);
  const response = await client.executeDepositWalletBatch(
    calls,
    depositAddress,
    buildDepositWalletDeadline(false),
  );
  const txHash = await waitForTxHash(response);

  // Post-submission verification: wait for the tx receipt and re-check approvals.
  if (txHash) {
    const provider = createPolygonProvider();
    const receipt = await provider.waitForTransaction(txHash, 1, 60_000);
    if (receipt?.status !== 1) {
      throw new Error(`approval tx reverted: ${txHash}`);
    }

    const postCheck = await checkClobApprovals(depositAddress);
    if (
      !(
        postCheck.pusdToCtf &&
        postCheck.pusdToExchange &&
        postCheck.pusdToNegRisk &&
        postCheck.ctfToExchange &&
        postCheck.ctfToNegRisk
      )
    ) {
      throw new Error('approvals still missing after on-chain submission');
    }
  }

  return { needed, txHash };
}