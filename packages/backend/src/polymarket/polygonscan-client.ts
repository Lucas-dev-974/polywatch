import { resolveBackendConfig } from '../system-config-resolver.js';

const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';
const POLYGON_CHAIN_ID = 137;
export const POLYGONSCAN_MAX_OFFSET = 1000;
/**
 * Etherscan caps page/offset pagination at a 10 000-record window
 * (page × offset ≤ 10 000). To read the *full* history we instead walk by
 * block range: keep page=1 and advance `startblock` past the last block
 * returned. This safety cap bounds the number of windows (≈ 1M transfers).
 */
export const POLYGONSCAN_MAX_WINDOWS = 1000;

export async function resolvePolygonscanMaxOffset(): Promise<number> {
  return resolveBackendConfig('backend.polygonscan.max_offset', POLYGONSCAN_MAX_OFFSET);
}

export async function resolvePolygonscanMaxWindows(): Promise<number> {
  return resolveBackendConfig('backend.polygonscan.max_windows', POLYGONSCAN_MAX_WINDOWS);
}
const REQUEST_DELAY_MS = 220;
const MAX_END_BLOCK = 999_999_999;

export interface PolygonscanTokenTxRow {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  contractAddress: string;
  logIndex?: string;
}

interface PolygonscanResponse {
  status: string;
  message: string;
  result: PolygonscanTokenTxRow[] | string;
}

export type PolygonscanErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'rate_limit'
  | 'api_error';

export class PolygonscanApiError extends Error {
  readonly code: PolygonscanErrorCode;

  constructor(code: PolygonscanErrorCode, detail: string) {
    super(`polygonscan_${code}:${detail}`);
    this.code = code;
  }
}

function resultText(data: PolygonscanResponse): string {
  return typeof data.result === 'string' ? data.result : data.message;
}

function isEmptyTokenTxResult(data: PolygonscanResponse): boolean {
  if (data.message === 'No transactions found') return true;
  if (data.result === 'No transactions found') return true;
  const text = resultText(data).toLowerCase();
  return text.includes('no transactions found');
}

function classifyApiFailure(data: PolygonscanResponse): PolygonscanApiError {
  const text = resultText(data);
  const lower = text.toLowerCase();

  if (
    lower.includes('invalid api key') ||
    lower.includes('missing/invalid api key')
  ) {
    return new PolygonscanApiError('invalid_api_key', text);
  }
  if (lower.includes('rate limit') || lower.includes('max calls per sec')) {
    return new PolygonscanApiError('rate_limit', text);
  }
  return new PolygonscanApiError('api_error', text || data.message || 'NOTOK');
}

function parsePolygonscanResponse(data: PolygonscanResponse): PolygonscanTokenTxRow[] {
  if (data.status === '1' && Array.isArray(data.result)) {
    return data.result;
  }
  if (isEmptyTokenTxResult(data)) {
    return [];
  }
  throw classifyApiFailure(data);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPolygonscanTokenTransfers(
  walletAddress: string,
  contractAddress: string,
  apiKey: string,
  options: {
    page?: number;
    offset?: number;
    startBlock?: number;
    endBlock?: number;
    delayMs?: number;
  } = {},
): Promise<PolygonscanTokenTxRow[]> {
  if (!apiKey) {
    throw new PolygonscanApiError('missing_api_key', 'missing_polygonscan_api_key');
  }

  const delayMs = options.delayMs ?? REQUEST_DELAY_MS;
  if (delayMs > 0) {
    await delay(delayMs);
  }

  const page = Math.max(options.page ?? 1, 1);
  const offset = Math.min(Math.max(options.offset ?? POLYGONSCAN_MAX_OFFSET, 1), 1000);
  const startBlock = Math.max(options.startBlock ?? 0, 0);
  const endBlock = options.endBlock ?? MAX_END_BLOCK;

  const params = new URLSearchParams({
    chainid: String(POLYGON_CHAIN_ID),
    module: 'account',
    action: 'tokentx',
    address: walletAddress,
    contractaddress: contractAddress,
    startblock: String(startBlock),
    endblock: String(endBlock),
    page: String(page),
    offset: String(offset),
    sort: 'asc',
    apikey: apiKey,
  });

  const url = `${ETHERSCAN_V2_BASE}?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new PolygonscanApiError('api_error', `http_${res.status}`);
  }

  const data = (await res.json()) as PolygonscanResponse;
  return parsePolygonscanResponse(data);
}

/**
 * Fetch the *complete* ERC-20 transfer history for a wallet/token by walking
 * forward over block ranges. Each request keeps page=1 and offset=1000 so we
 * never hit Etherscan's 10 000-record page/offset window; we then advance
 * `startblock` to the last block seen and continue. Boundary-block overlaps
 * are removed by the caller's tx-hash/logIndex dedup.
 *
 * `truncated` is true only if we stop early (safety cap or unrecoverable
 * single-block overflow), i.e. the history may be incomplete.
 */
export async function fetchAllPolygonscanTokenTransfers(
  walletAddress: string,
  contractAddress: string,
  apiKey: string,
  options: { maxWindows?: number } = {},
): Promise<{ rows: PolygonscanTokenTxRow[]; truncated: boolean }> {
  const maxWindows = Math.max(options.maxWindows ?? POLYGONSCAN_MAX_WINDOWS, 1);
  const all: PolygonscanTokenTxRow[] = [];
  let startBlock = 0;
  let truncated = false;

  for (let window = 0; window < maxWindows; window++) {
    let batch: PolygonscanTokenTxRow[];
    try {
      batch = await fetchPolygonscanTokenTransfers(
        walletAddress,
        contractAddress,
        apiKey,
        {
          page: 1,
          offset: POLYGONSCAN_MAX_OFFSET,
          startBlock,
          delayMs: window === 0 ? 0 : REQUEST_DELAY_MS,
        },
      );
    } catch (err) {
      if (all.length > 0) {
        truncated = true;
        break;
      }
      throw err;
    }

    all.push(...batch);

    // Last window: fewer than a full page means we've reached the end.
    if (batch.length < POLYGONSCAN_MAX_OFFSET) {
      break;
    }

    const lastBlock = Number(batch[batch.length - 1]!.blockNumber);
    if (!Number.isFinite(lastBlock)) {
      truncated = true;
      break;
    }

    // A full page entirely within one block (>1000 transfers in a single
    // block) cannot be advanced without skipping; extremely unlikely for
    // collateral tokens, but guard against an infinite loop.
    if (lastBlock <= startBlock) {
      startBlock = lastBlock + 1;
      truncated = true;
    } else {
      // Re-query from the last block (inclusive) so we don't drop transfers
      // sharing that block; dedup removes the overlap.
      startBlock = lastBlock;
    }

    if (window === maxWindows - 1) {
      truncated = true;
    }
  }

  return { rows: all, truncated };
}

export function parsePolygonscanTokenValueUsdc(row: PolygonscanTokenTxRow): number {
  const raw = BigInt(row.value);
  const decimals = Number(row.tokenDecimal);
  const divisor = 10 ** (Number.isFinite(decimals) ? decimals : 6);
  return Number(raw) / divisor;
}
