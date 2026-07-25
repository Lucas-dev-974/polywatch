import type { CryptoAlgoOptimizeReport } from '@polywatch/core';
import { api } from '../api';

export type { CryptoAlgoOptimizeReport };

export type CryptoAlgoOptimizeReportResponse = CryptoAlgoOptimizeReport & {
  configFingerprint: string;
};

function buildQuery(params?: {
  closedFrom?: string | null;
  closedTo?: string | null;
}): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  if (params.closedFrom) qs.set('closedFrom', params.closedFrom);
  if (params.closedTo) qs.set('closedTo', params.closedTo);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function fetchCryptoAlgoOptimizeReport(params?: {
  closedFrom?: string | null;
  closedTo?: string | null;
}): Promise<CryptoAlgoOptimizeReportResponse> {
  return api<CryptoAlgoOptimizeReportResponse>(
    `/algo/optimize-report${buildQuery(params)}`,
  );
}

export {
  applyRecommendedCryptoAlgoConfig,
  fetchCurrentCryptoAlgoConfigFingerprint,
} from './analysis-reports';
