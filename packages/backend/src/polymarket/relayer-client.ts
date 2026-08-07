import type { ClobCredentials } from '@polywatch/core';
import { createPolygonWalletClient } from '@polywatch/core';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import {
  ClientRelayerTransactionResponse,
  RelayerTransactionResponse,
  RelayClient,
  RelayerTxType,
  type DepositWalletCall,
  type Transaction,
} from '@polymarket/builder-relayer-client';
import { HttpClient, POST, type RequestOptions } from '@polymarket/builder-relayer-client/dist/http-helpers/index.js';
import { SUBMIT_TRANSACTION } from '@polymarket/builder-relayer-client/dist/endpoints.js';
import { decrypt } from '../crypto/encryption.js';
import { getRedis } from '../redis.js';
import { validatePrivateKey } from '../crypto/private-key.js';
import { getBuilderCreds, resolveRelayerUrl } from './clob-creds.js';
import {
  buildUnwrapDepositWalletCalls,
  buildUnwrapTransactions,
  transactionsToDepositWalletCalls,
} from './collateral-ramp.js';
import { createPolygonProvider, POLYGON_CHAIN_ID, parsePusdAmountRaw } from './polygon.js';
import { assertRelayerWithdrawReady } from './wallet-validation.js';
import { buildDepositWalletDeadline } from './deposit-wallet-signing.js';
import { normalizeRelayerError } from './relayer-errors.js';
import {
  encodePusdTransferCalldata,
  PUSD_TOKEN_ADDRESS,
} from './pusd-erc20.js';
import { deriveRelayerExecutionWallet } from './relayer-wallet-derive.js';

export { normalizeRelayerError } from './relayer-errors.js';

export const SIGNATURE_TYPE_EOA = 0;
export const SIGNATURE_TYPE_POLY_PROXY = 1;
export const SIGNATURE_TYPE_POLY_GNOSIS_SAFE = 2;
export const SIGNATURE_TYPE_DEPOSIT_WALLET = 3;

export type RelayerWithdrawMode = 'proxy' | 'safe' | 'deposit';
export type RelayerWithdrawAsset = 'pusd' | 'usdc_e';

export class BuilderNotConfiguredError extends Error {
  constructor() {
    super('builder_not_configured');
    this.name = 'BuilderNotConfiguredError';
  }
}

const PENDING_TTL_SECONDS = 300; // 5 minutes - prevents double submission
/** Placeholder written with SET NX before the on-chain call completes. */
const RESERVED_MARKER = '__reserved__';

/**
 * Idempotency key built on the raw 6-decimal integer amount: float inputs
 * like 10.1 vs 10.100000001 would otherwise produce distinct keys for the
 * same effective withdrawal.
 */
function idempotencyKey(
  depositAddress: string,
  recipientAddress: string,
  amountRaw: bigint,
  asset: RelayerWithdrawAsset,
): string {
  return `withdraw:pending:${depositAddress.toLowerCase()}:${recipientAddress.toLowerCase()}:${amountRaw.toString()}:${asset}`;
}

type IdemReservation =
  | { kind: 'reserved' }
  | { kind: 'existing'; hash: string }
  | { kind: 'inflight' };

/**
 * Atomically reserve the idempotency key before submitting on-chain.
 * Returns an existing completed hash, or inflight if another request holds the reservation.
 */
async function reserveOrGet(idemKey: string): Promise<IdemReservation> {
  const redis = getRedis();
  const set = await redis.set(
    idemKey,
    RESERVED_MARKER,
    'EX',
    PENDING_TTL_SECONDS,
    'NX',
  );
  if (set === 'OK') return { kind: 'reserved' };

  const existing = await redis.get(idemKey);
  if (existing && existing !== RESERVED_MARKER) {
    return { kind: 'existing', hash: existing };
  }
  return { kind: 'inflight' };
}

async function markCompleted(idemKey: string, hash: string): Promise<void> {
  await getRedis().set(idemKey, hash, 'EX', PENDING_TTL_SECONDS);
}

async function clearReservation(idemKey: string): Promise<void> {
  const redis = getRedis();
  const current = await redis.get(idemKey);
  if (current === RESERVED_MARKER) {
    await redis.del(idemKey);
  }
}

export function resolveWithdrawMode(
  signatureType: number,
  isL2Deposit: boolean,
): RelayerWithdrawMode | 'eoa' {
  if (signatureType === SIGNATURE_TYPE_DEPOSIT_WALLET) return 'deposit';
  if (signatureType === SIGNATURE_TYPE_POLY_GNOSIS_SAFE) return 'safe';
  if (signatureType === SIGNATURE_TYPE_POLY_PROXY) return 'proxy';
  if (!isL2Deposit) return 'eoa';
  return 'proxy';
}

/** Picks relayer mode from on-chain deposit address, not only the configured signature type. */
export function resolveEffectiveWithdrawMode(
  signerAddress: string | null | undefined,
  depositAddress: string,
  signatureType: number,
  isL2Deposit: boolean,
): RelayerWithdrawMode | 'eoa' {
  if (!isL2Deposit) {
    return resolveWithdrawMode(signatureType, false);
  }

  if (!signerAddress?.trim()) {
    return resolveWithdrawMode(signatureType, true);
  }

  const deposit = depositAddress.toLowerCase();
  const proxy = deriveRelayerExecutionWallet(signerAddress, 'proxy').toLowerCase();
  const safe = deriveRelayerExecutionWallet(signerAddress, 'safe').toLowerCase();

  if (deposit === proxy) return 'proxy';
  if (deposit === safe) return 'safe';
  return 'deposit';
}

function createSignerWallet(privateKey: string) {
  return createPolygonWalletClient(validatePrivateKey(privateKey));
}

export function encodePusdTransferTx(
  recipient: string,
  amountRaw: bigint,
): Transaction {
  return {
    to: PUSD_TOKEN_ADDRESS,
    data: encodePusdTransferCalldata(recipient, amountRaw),
    value: '0',
  };
}

function buildRelayerTransactions(
  asset: RelayerWithdrawAsset,
  recipient: string,
  amountRaw: bigint,
): Transaction[] {
  if (asset === 'usdc_e') {
    return buildUnwrapTransactions(recipient, amountRaw);
  }
  return [encodePusdTransferTx(recipient, amountRaw)];
}

export function buildRelayerDepositWalletCalls(
  asset: RelayerWithdrawAsset,
  recipient: string,
  amountRaw: bigint,
): DepositWalletCall[] {
  if (asset === 'usdc_e') {
    return buildUnwrapDepositWalletCalls(recipient, amountRaw);
  }
  return transactionsToDepositWalletCalls(buildRelayerTransactions(asset, recipient, amountRaw));
}

function relayerDescription(asset: RelayerWithdrawAsset): string {
  return asset === 'usdc_e'
    ? 'Polywatch pUSD unwrap to USDC.e'
    : 'Polywatch pUSD withdraw';
}

export function createBuilderRelayClient(creds: ClobCredentials): RelayClient {
  const builderCreds = getBuilderCreds(creds);
  if (!builderCreds) throw new BuilderNotConfiguredError();
  const builderConfig = new BuilderConfig({ localBuilderCreds: builderCreds });
  return new RelayClient(resolveRelayerUrl(creds), POLYGON_CHAIN_ID, undefined, builderConfig);
}

export async function fetchRelayerNonce(
  creds: ClobCredentials,
  signerAddress: string,
  signerType: string,
): Promise<string> {
  const client = createBuilderRelayClient(creds);
  const payload = await client.getNonce(signerAddress, signerType);
  return payload.nonce;
}

export async function submitRelayerTransaction(
  creds: ClobCredentials,
  request: Record<string, unknown>,
): Promise<ClientRelayerTransactionResponse> {
  const builderCreds = getBuilderCreds(creds);
  if (!builderCreds) throw new BuilderNotConfiguredError();
  const builderConfig = new BuilderConfig({ localBuilderCreds: builderCreds });
  const client = createBuilderRelayClient(creds);
  const body = JSON.stringify(request);
  const relayerUrl = resolveRelayerUrl(creds);
  try {
    const headers = await builderConfig.generateBuilderHeaders(POST, SUBMIT_TRANSACTION, body);
    const httpClient = new HttpClient();
    const resp = await httpClient.send(`${relayerUrl}${SUBMIT_TRANSACTION}`, POST, {
      headers: {
        ...(headers ?? {}),
        'Content-Type': 'application/json',
      } as NonNullable<RequestOptions['headers']>,
      data: body,
    });
    const data = resp.data as {
      transactionID: string;
      state: string;
      transactionHash?: string;
    };
    return new ClientRelayerTransactionResponse(
      data.transactionID,
      data.state,
      data.transactionHash ?? '',
      client,
    );
  } catch (err) {
    throw normalizeRelayerError(err);
  }
}

export function createRelayClient(
  creds: ClobCredentials,
  signerPrivateKey: string,
  mode: RelayerWithdrawMode,
): RelayClient {
  const builderCreds = getBuilderCreds(creds);
  if (!builderCreds) throw new BuilderNotConfiguredError();

  const builderConfig = new BuilderConfig({ localBuilderCreds: builderCreds });
  const wallet = createSignerWallet(signerPrivateKey);
  const relayerUrl = resolveRelayerUrl(creds);

  if (mode === 'deposit') {
    return new RelayClient(relayerUrl, POLYGON_CHAIN_ID, wallet, builderConfig);
  }

  const relayTxType = mode === 'safe' ? RelayerTxType.SAFE : RelayerTxType.PROXY;
  return new RelayClient(relayerUrl, POLYGON_CHAIN_ID, wallet, builderConfig, relayTxType);
}

export async function waitForTxHash(
  response: ClientRelayerTransactionResponse | RelayerTransactionResponse,
): Promise<string> {
  const result = await response.wait();
  if (!result) throw new Error('relayer_tx_failed');

  const hash =
    result.transactionHash ??
    (response as ClientRelayerTransactionResponse).transactionHash ??
    response.hash;
  if (!hash) throw new Error('relayer_no_tx_hash');

  const receipt = await createPolygonProvider().getTransactionReceipt(hash);
  if (!receipt || receipt.status === 0) throw new Error('relayer_tx_reverted');

  return hash;
}

export async function withdrawViaRelayer(
  creds: ClobCredentials,
  depositAddress: string,
  recipientAddress: string,
  amount: number,
  mode: RelayerWithdrawMode,
  asset: RelayerWithdrawAsset,
): Promise<string> {
  if (!creds.signerPkEnc) throw new Error('signer_missing');

  const amountRaw = parsePusdAmountRaw(amount);
  const idemKey = idempotencyKey(depositAddress, recipientAddress, amountRaw, asset);
  const reservation = await reserveOrGet(idemKey);
  if (reservation.kind === 'existing') return reservation.hash;
  if (reservation.kind === 'inflight') {
    throw new Error('withdraw_in_progress');
  }

  await assertRelayerWithdrawReady(
    creds.signerPkEnc,
    depositAddress,
    mode,
    amountRaw,
  );

  const signerPrivateKey = decrypt(creds.signerPkEnc);
  const client = createRelayClient(creds, signerPrivateKey, mode);

  try {
    let txHash: string;
    if (mode === 'deposit') {
      const response = await client.executeDepositWalletBatch(
        buildRelayerDepositWalletCalls(asset, recipientAddress, amountRaw),
        depositAddress,
        buildDepositWalletDeadline(false),
      );
      txHash = await waitForTxHash(response);
    } else {
      const response = await client.execute(
        buildRelayerTransactions(asset, recipientAddress, amountRaw),
        relayerDescription(asset),
      );
      txHash = await waitForTxHash(response);
    }

    await markCompleted(idemKey, txHash);
    return txHash;
  } catch (err) {
    await clearReservation(idemKey).catch(() => {});
    throw normalizeRelayerError(err);
  }
}

