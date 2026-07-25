import { api } from '../api';

export type WalletHistoryCategory =
  | 'trade'
  | 'redeem'
  | 'split'
  | 'merge'
  | 'other';

export interface WalletHistoryEntry {
  id: string;
  timestamp: number;
  category: WalletHistoryCategory;
  title: string;
  amount: number | null;
  asset: string;
  side: 'BUY' | 'SELL' | null;
  price: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  source: 'polymarket';
}

export interface WalletHistoryResponse {
  entries: WalletHistoryEntry[];
  queriedAddress: string;
  walletAccountId: number;
  walletLabel: string;
  limit: number;
  offset: number;
}

export function walletHistoryCategoryLabel(category: WalletHistoryCategory): string {
  switch (category) {
    case 'trade':
      return 'Trade';
    case 'redeem':
      return 'Rachat';
    case 'split':
      return 'Split';
    case 'merge':
      return 'Fusion';
    default:
      return 'Autre';
  }
}

export function walletHistoryCategoryClass(category: WalletHistoryCategory): string {
  switch (category) {
    case 'trade':
      return 'badge real';
    case 'redeem':
      return 'badge sim';
    case 'split':
    case 'merge':
      return 'badge neutral';
    default:
      return 'badge neutral';
  }
}

export function formatWalletHistoryError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Impossible de charger l historique wallet';
  }
  if (err.message.startsWith('wallet_history_fetch_failed')) {
    return 'Service Polymarket indisponible. Reessayez dans quelques instants.';
  }
  return err.message;
}

export async function fetchWalletHistory(
  walletAccountId: number,
  options: { limit?: number; offset?: number } = {},
): Promise<WalletHistoryResponse> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.offset != null) params.set('offset', String(options.offset));
  const qs = params.toString();
  return api<WalletHistoryResponse>(
    `/wallet/accounts/${walletAccountId}/history${qs ? `?${qs}` : ''}`,
  );
}
