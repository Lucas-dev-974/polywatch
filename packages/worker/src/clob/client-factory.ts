import { createPolygonWalletClient } from '@polywatch/core';
import {
  Chain,
  ClobClient,
  SignatureTypeV2,
} from '@polymarket/clob-client-v2';
import { config } from '../config.js';
import type { PlainApiClobCredentials } from './types.js';

/** CLOB V2 client for deposit-wallet trading (`POLY_1271`, funder = deposit address). */
export function createDepositWalletClobClient(
  creds: PlainApiClobCredentials,
  depositAddress: string,
): ClobClient {
  const signer = createPolygonWalletClient(creds.signerPrivateKey);

  return new ClobClient({
    host: config.clobApi,
    chain: Chain.POLYGON,
    signer,
    creds: {
      key: creds.apiKey,
      secret: creds.secret,
      passphrase: creds.passphrase,
    },
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: depositAddress,
  });
}
