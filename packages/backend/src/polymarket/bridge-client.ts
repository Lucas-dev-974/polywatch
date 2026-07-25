const DEFAULT_BRIDGE_URL = 'https://bridge.polymarket.com';

export type BridgeDepositAssetSymbol = 'BTC' | 'ETH' | 'POL' | 'SOL';

export interface BridgeToken {
  name: string;
  symbol: string;
  address: string;
  decimals: number;
}

export interface BridgeSupportedAsset {
  chainId: string;
  chainName: string;
  token: BridgeToken;
  minCheckoutUsd: number;
}

export interface BridgeSupportedAssetsResponse {
  supportedAssets: BridgeSupportedAsset[];
}

export interface BridgeDepositAddresses {
  evm?: string;
  svm?: string;
  btc?: string;
  tvm?: string;
}

interface BridgeDepositAddressesResponse {
  address?: BridgeDepositAddresses & { tron?: string };
  evm?: string;
  svm?: string;
  btc?: string;
  tvm?: string;
  tron?: string;
}

export function normalizeDepositAddresses(
  raw: BridgeDepositAddressesResponse,
): BridgeDepositAddresses {
  const nested = raw.address ?? raw;
  return {
    evm: nested.evm,
    svm: nested.svm,
    btc: nested.btc,
    tvm: nested.tvm ?? nested.tron,
  };
}

export interface BridgeQuoteRequest {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
}

export interface BridgeQuoteResponse {
  estCheckoutTimeMs?: number;
  estInputUsd?: number;
  estOutputUsd?: number;
  estToTokenBaseUnit: string;
  quoteId?: string;
}

export type BridgeTransactionStatus =
  | 'DEPOSIT_DETECTED'
  | 'PROCESSING'
  | 'ORIGIN_TX_CONFIRMED'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'FAILED';

export interface BridgeTransaction {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  status: BridgeTransactionStatus;
  txHash?: string;
  createdTimeMs?: number;
}

export interface BridgeStatusResponse {
  transactions: BridgeTransaction[];
}

const PREFERRED_CHAINS: Record<BridgeDepositAssetSymbol, string[]> = {
  BTC: ['Bitcoin'],
  ETH: ['Ethereum'],
  POL: ['Polygon'],
  SOL: ['Solana'],
};

function bridgeBaseUrl(): string {
  return process.env.POLYMARKET_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;
}

async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${bridgeBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bridge_http_${res.status}${text ? `: ${text}` : ''}`);
  }

  return res.json() as Promise<T>;
}

export function fetchSupportedAssets(): Promise<BridgeSupportedAssetsResponse> {
  return bridgeFetch('/supported-assets');
}

export function fetchBridgeQuote(body: BridgeQuoteRequest): Promise<BridgeQuoteResponse> {
  return bridgeFetch('/quote', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createDepositAddresses(
  depositWallet: string,
): Promise<BridgeDepositAddresses> {
  const raw = await bridgeFetch<BridgeDepositAddressesResponse>('/deposit', {
    method: 'POST',
    body: JSON.stringify({ address: depositWallet }),
  });
  return normalizeDepositAddresses(raw);
}

export function fetchBridgeStatus(
  bridgeAddress: string,
): Promise<BridgeStatusResponse> {
  return bridgeFetch(`/status/${encodeURIComponent(bridgeAddress)}`);
}

const NATIVE_EVM_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function isNativeBridgeToken(
  symbol: BridgeDepositAssetSymbol,
  asset: BridgeSupportedAsset,
): boolean {
  const addr = asset.token.address.toLowerCase();
  if (symbol === 'BTC') return !addr.startsWith('0x');
  if (symbol === 'SOL' && asset.chainName.toLowerCase() === 'solana') {
    return !addr.startsWith('0x');
  }
  return addr === NATIVE_EVM_TOKEN;
}

function pickPreferredOnChain(
  matches: BridgeSupportedAsset[],
  symbol: BridgeDepositAssetSymbol,
  chainName: string,
): BridgeSupportedAsset | undefined {
  const onChain = matches.filter(
    (a) => a.chainName.toLowerCase() === chainName.toLowerCase(),
  );
  return (
    onChain.find((a) => isNativeBridgeToken(symbol, a)) ??
    onChain[0]
  );
}

export function pickBridgeDepositAsset(
  assets: BridgeSupportedAsset[],
  symbol: BridgeDepositAssetSymbol,
): BridgeSupportedAsset {
  const matches = assets.filter(
    (a) => a.token.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (!matches.length) throw new Error(`bridge_asset_unsupported:${symbol}`);

  for (const chainName of PREFERRED_CHAINS[symbol]) {
    const preferred = pickPreferredOnChain(matches, symbol, chainName);
    if (preferred) return preferred;
  }

  return (
    matches.find((a) => isNativeBridgeToken(symbol, a)) ??
    matches[0]
  );
}
