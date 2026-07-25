import type {
  AnalysisReportDetail,
  AnalysisReportSummary,
  CompareAnalysisReportsResult,
  CryptoAlgoOptimizeReport,
} from '@polywatch/core';
import { api } from '../api';

export type {
  AnalysisReportDetail,
  AnalysisReportSummary,
  CompareAnalysisReportsResult,
  CryptoAlgoOptimizeReport,
};

export type CryptoAlgoOptimizeReportResponse = CryptoAlgoOptimizeReport & {
  configFingerprint: string;
};

export interface GenerateReportInput {
  type: 'crypto_algo_optimize';
  label?: string | null;
  note?: string | null;
  params?: {
    closedFrom?: string | null;
    closedTo?: string | null;
  };
}

export async function fetchAnalysisReports(options?: {
  limit?: number;
  offset?: number;
}): Promise<{ items: AnalysisReportSummary[]; total: number }> {
  const qs = new URLSearchParams();
  if (options?.limit != null) qs.set('limit', String(options.limit));
  if (options?.offset != null) qs.set('offset', String(options.offset));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return api(`/reports${suffix}`);
}

export async function fetchAnalysisReport(id: number): Promise<AnalysisReportDetail> {
  return api(`/reports/${id}`);
}

export async function generateAnalysisReport(
  input: GenerateReportInput,
): Promise<AnalysisReportDetail> {
  return api('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function compareAnalysisReports(
  idA: number,
  idB: number,
): Promise<CompareAnalysisReportsResult> {
  return api(`/reports/compare?a=${idA}&b=${idB}`);
}

export async function deleteAnalysisReport(id: number): Promise<void> {
  await api(`/reports/${id}`, { method: 'DELETE' });
}

export async function updateAnalysisReportMeta(
  id: number,
  patch: { label?: string | null; note?: string | null },
): Promise<AnalysisReportDetail> {
  return api(`/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchCurrentCryptoAlgoConfigFingerprint(): Promise<string> {
  const cfg = await api<{ cryptoAlgoConfigFingerprint: string }>('/risk-config');
  return cfg.cryptoAlgoConfigFingerprint;
}

export async function applyRecommendedCryptoAlgoConfig(
  report: CryptoAlgoOptimizeReport,
  expectedFingerprint: string,
): Promise<void> {
  if (!report.recommendedConfig.applicable) {
    throw new Error('Aucun paramètre recommandé applicable');
  }
  await api('/risk-config', {
    method: 'PUT',
    body: JSON.stringify({
      ...report.recommendedConfig.patch,
      expectedCryptoAlgoConfigFingerprint: expectedFingerprint,
      revisionSource: 'report_apply',
    }),
  });
}
