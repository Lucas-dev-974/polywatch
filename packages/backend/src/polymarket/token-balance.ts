import { ethers } from 'ethers';
import pino from 'pino';
import { PUSD_DECIMALS } from '@polywatch/core';
import { createPolygonProvider } from './polygon.js';
import { PUSD_BALANCE_ABI } from './pusd-erc20.js';

const log = pino({ name: 'token-balance' });

/**
 * Strict variant: an RPC failure throws instead of silently returning 0.
 * A phantom 0 propagates into worker sizing and UI balances as if the
 * wallet were empty — callers must decide how to degrade.
 */
export async function fetchErc20Balance(
  tokenAddress: string,
  walletAddress: string,
): Promise<number> {
  const token = new ethers.Contract(
    tokenAddress,
    PUSD_BALANCE_ABI,
    createPolygonProvider(),
  );
  const bal: bigint = await token.balanceOf(walletAddress);
  return Number(ethers.formatUnits(bal, PUSD_DECIMALS));
}

/** Tolerant variant for display-only contexts: logs and returns null. */
export async function tryFetchErc20Balance(
  tokenAddress: string,
  walletAddress: string,
): Promise<number | null> {
  try {
    return await fetchErc20Balance(tokenAddress, walletAddress);
  } catch (err) {
    log.warn({ err, tokenAddress, walletAddress }, 'erc20 balance fetch failed');
    return null;
  }
}
