import { createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { normalizePrivateKeyHex } from './private-key.js';

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC_URL =
  process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com';

/** viem wallet client for Polymarket SDKs (relayer, CLOB). */
export function createPolygonWalletClient(privateKey: string): WalletClient {
  const account = privateKeyToAccount(normalizePrivateKeyHex(privateKey));
  return createWalletClient({
    account,
    chain: polygon,
    transport: http(POLYGON_RPC_URL),
  });
}
