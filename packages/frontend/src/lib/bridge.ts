import { api } from '../api';

export type BridgeDepositAssetSymbol = 'BTC' | 'ETH' | 'POL' | 'SOL';

export const BRIDGE_DEPOSIT_CRYPTO_OPTIONS: {
  value: BridgeDepositAssetSymbol;
  label: string;
}[] = [
  { value: 'BTC', label: 'Bitcoin (BTC)' },
  { value: 'ETH', label: 'Ethereum (ETH)' },
  { value: 'POL', label: 'Polygon (POL)' },
  { value: 'SOL', label: 'Solana (SOL)' },
];

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

export interface BridgeDepositQuote {
  asset: BridgeSupportedAsset;
  fromAmountBaseUnit: string;
  fromAmountFormatted: string;
  estOutputPusd: number;
  bridgeAddress: string;
  bridgeAddressKind: BridgeAddressKind;
  metamaskSupported: boolean;
  quoteApproximate?: boolean;
  warningBtcApproximate?: boolean;
}

export type BridgeAddressKind = 'evm' | 'btc' | 'svm' | 'tvm';

export const BRIDGE_ADDRESS_KINDS: BridgeAddressKind[] = [
  'evm',
  'btc',
  'svm',
  'tvm',
];

export const BRIDGE_ADDRESS_LABELS: Record<BridgeAddressKind, string> = {
  evm: 'EVM (ETH, USDC, etc.)',
  btc: 'Bitcoin',
  svm: 'Solana',
  tvm: 'Tron',
};

export function fetchBridgeSupportedAssets(): Promise<BridgeSupportedAssetsResponse> {
  return api('/wallet/bridge/supported-assets');
}

export function fetchBridgeDepositAddresses(): Promise<BridgeDepositAddresses> {
  return api('/wallet/bridge/deposit-addresses', { method: 'POST' });
}

export function fetchBridgeDepositQuote(
  pusdAmount: number,
  assetSymbol: BridgeDepositAssetSymbol,
): Promise<BridgeDepositQuote> {
  return api('/wallet/bridge/deposit-quote', {
    method: 'POST',
    body: JSON.stringify({ pusdAmount, assetSymbol }),
  });
}

export function fetchBridgeStatus(address: string): Promise<BridgeStatusResponse> {
  return api(`/wallet/bridge/status/${encodeURIComponent(address)}`);
}

export function bridgeStatusLabel(status: BridgeTransactionStatus): string {
  switch (status) {
    case 'DEPOSIT_DETECTED':
      return 'Depot detecte';
    case 'PROCESSING':
      return 'En cours';
    case 'ORIGIN_TX_CONFIRMED':
      return 'Tx source confirmee';
    case 'SUBMITTED':
      return 'Soumis sur Polygon';
    case 'COMPLETED':
      return 'Termine';
    case 'FAILED':
      return 'Echec';
    default:
      return status;
  }
}

export function isBridgeStatusTerminal(status: BridgeTransactionStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}
