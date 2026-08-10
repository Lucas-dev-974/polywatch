import type { MarketMetricsDto, MarketTick } from '@polywatch/core/types';

import { api } from '../api';
import { formatAdaptiveAmount } from './position';

export type { MarketTick, MarketMetricsDto as MarketMetrics } from '@polywatch/core/types';

export function formatPrice(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatAdaptiveAmount(value);
}

export const formatSpread = formatPrice;

export async function fetchMarketMetrics(
  conditionId: string,
  options: {
    assetId?: string;
    includeHistory?: boolean;
    cryptoSymbol?: string;
    interval?: string | null;
  } = {},
): Promise<MarketMetricsDto> {
  const params = new URLSearchParams();
  if (options.assetId) params.set('assetId', options.assetId);
  if (options.includeHistory) params.set('includeHistory', 'true');
  if (options.cryptoSymbol) params.set('cryptoSymbol', options.cryptoSymbol);
  if (options.interval) params.set('interval', options.interval);
  const qs = params.toString();
  return api<MarketMetricsDto>(
    `/markets/${encodeURIComponent(conditionId)}/metrics${qs ? `?${qs}` : ''}`,
  );
}
