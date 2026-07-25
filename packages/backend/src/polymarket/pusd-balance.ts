import { PUSD_TOKEN_ADDRESS, USDC_E_ADDRESS } from '@polywatch/core';
import { fetchErc20Balance, tryFetchErc20Balance } from './token-balance.js';

/** Throws on RPC failure — use for sizing/validation paths. */
export async function fetchPusdBalance(address: string): Promise<number> {
  return fetchErc20Balance(PUSD_TOKEN_ADDRESS, address);
}

/** Throws on RPC failure — use for sizing/validation paths. */
export async function fetchUsdcEBalance(address: string): Promise<number> {
  return fetchErc20Balance(USDC_E_ADDRESS, address);
}

/** Display-only: logs and returns null when the RPC is unavailable. */
export async function tryFetchPusdBalance(address: string): Promise<number | null> {
  return tryFetchErc20Balance(PUSD_TOKEN_ADDRESS, address);
}

/** Display-only: logs and returns null when the RPC is unavailable. */
export async function tryFetchUsdcEBalance(address: string): Promise<number | null> {
  return tryFetchErc20Balance(USDC_E_ADDRESS, address);
}
