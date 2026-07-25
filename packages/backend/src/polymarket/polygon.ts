import { ethers } from 'ethers';
import {
  amountToRaw6Decimals,
  POLYGON_CHAIN_ID,
  POLYGON_RPC_URL,
} from '@polywatch/core';

export { POLYGON_CHAIN_ID, POLYGON_RPC_URL };

/** RPC call timeout: 30 seconds — ethers.js default is 300s. */
export const POLYGON_RPC_TIMEOUT_MS = 30_000;

export function createPolygonProvider(): ethers.JsonRpcProvider {
  const provider = new ethers.JsonRpcProvider(
    POLYGON_RPC_URL,
    { name: 'polygon', chainId: POLYGON_CHAIN_ID },
    { staticNetwork: true },
  );
  const conn = provider._getConnection();
  if (conn) {
    conn.timeout = POLYGON_RPC_TIMEOUT_MS;
  }
  return provider;
}

export function parsePusdAmountRaw(amount: number): bigint {
  return amountToRaw6Decimals(amount);
}
