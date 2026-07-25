import type { DataSource } from 'typeorm';
import { AnalysisReport } from '../entities/AnalysisReport.js';
import type { CryptoAlgoOptimizeReport } from '../crypto-algo/optimize-report.js';
import {
  loadCryptoAlgoOptimizeReport,
  type CryptoAlgoOptimizeReportFilters,
} from '../crypto-algo/load-optimize-report-data.js';
import {
  compareCryptoAlgoOptimizeReports,
  type AnalysisReportDetail,
  type AnalysisReportParams,
  type AnalysisReportSummary,
  type CompareAnalysisReportsResult,
} from '../crypto-algo/compare-reports.js';

export const ANALYSIS_REPORT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const ANALYSIS_REPORT_MAX_COUNT = 50;

export interface GenerateAnalysisReportOptions {
  type: 'crypto_algo_optimize';
  label?: string | null;
  note?: string | null;
  params?: Partial<AnalysisReportParams>;
}

export interface ListAnalysisReportsOptions {
  limit?: number;
  offset?: number;
  type?: 'crypto_algo_optimize';
}

function defaultLabel(type: string, createdAt: Date): string {
  const when = createdAt.toISOString().replace('T', ' ').slice(0, 16);
  if (type === 'crypto_algo_optimize') return `Crypto Algo · sim · ${when}`;
  return `Rapport · ${when}`;
}

function buildScopeSummary(params: AnalysisReportParams, report: CryptoAlgoOptimizeReport): string {
  const parts = [`${params.mode} · ${params.reason}`];
  if (params.closedFrom || params.closedTo) {
    parts.push(
      `fermées ${params.closedFrom?.slice(0, 10) ?? '…'} → ${params.closedTo?.slice(0, 10) ?? '…'}`,
    );
  }
  parts.push(`${report.totals.closed} fermées / ${report.totals.all} total`);
  return parts.join(' · ');
}

function normalizeParams(raw?: Partial<AnalysisReportParams>): AnalysisReportParams {
  return {
    mode: 'sim',
    reason: 'ALGO_OPEN',
    closedFrom: raw?.closedFrom ?? null,
    closedTo: raw?.closedTo ?? null,
  };
}

function toFilters(params: AnalysisReportParams): CryptoAlgoOptimizeReportFilters {
  return {
    closedFrom: params.closedFrom ? new Date(params.closedFrom) : null,
    closedTo: params.closedTo ? new Date(params.closedTo) : null,
  };
}

function toSummary(row: AnalysisReport): AnalysisReportSummary {
  const params = JSON.parse(row.paramsJson) as AnalysisReportParams;
  let realizedAlgo: number | null = null;
  let verdictTitle: string | null = null;
  try {
    const payload = JSON.parse(row.payloadJson) as CryptoAlgoOptimizeReport;
    realizedAlgo = payload.totals.realizedAlgo;
    verdictTitle = payload.verdict.title;
  } catch {
    // keep nulls
  }
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    label: row.label,
    note: row.note,
    type: row.type,
    params,
    configFingerprint: row.configFingerprint,
    scopeSummary: row.scopeSummary,
    positionsClosedCount: row.positionsClosedCount,
    positionsTotalCount: row.positionsTotalCount,
    realizedAlgo,
    verdictTitle,
  };
}

function toDetail(row: AnalysisReport): AnalysisReportDetail {
  return {
    ...toSummary(row),
    payload: JSON.parse(row.payloadJson) as CryptoAlgoOptimizeReport,
  };
}

export class AnalysisReportService {
  constructor(private readonly ds: DataSource) {}

  async list(options: ListAnalysisReportsOptions = {}): Promise<{
    items: AnalysisReportSummary[];
    total: number;
  }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const repo = this.ds.getRepository(AnalysisReport);
    const qb = repo.createQueryBuilder('r').orderBy('r.createdAt', 'DESC');
    if (options.type) {
      qb.andWhere('r.type = :type', { type: options.type });
    }
    const [rows, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { items: rows.map(toSummary), total };
  }

  async getById(id: number): Promise<AnalysisReportDetail | null> {
    const row = await this.ds.getRepository(AnalysisReport).findOne({ where: { id } });
    return row ? toDetail(row) : null;
  }

  async generateAndSave(options: GenerateAnalysisReportOptions): Promise<AnalysisReportDetail> {
    if (options.type !== 'crypto_algo_optimize') {
      throw new Error('unsupported_report_type');
    }
    const params = normalizeParams(options.params);
    const { report, configFingerprint } = await loadCryptoAlgoOptimizeReport(
      this.ds,
      toFilters(params),
    );
    const createdAt = new Date();
    const row = this.ds.getRepository(AnalysisReport).create({
      label: options.label?.trim() || defaultLabel(options.type, createdAt),
      note: options.note?.trim() || null,
      type: options.type,
      paramsJson: JSON.stringify(params),
      payloadJson: JSON.stringify(report),
      configFingerprint,
      scopeSummary: buildScopeSummary(params, report),
      positionsClosedCount: report.totals.closed,
      positionsTotalCount: report.totals.all,
    });
    const saved = await this.ds.getRepository(AnalysisReport).save(row);
    await this.enforceRetention();
    return toDetail(saved);
  }

  async updateMeta(
    id: number,
    patch: { label?: string | null; note?: string | null },
  ): Promise<AnalysisReportDetail | null> {
    const repo = this.ds.getRepository(AnalysisReport);
    const row = await repo.findOne({ where: { id } });
    if (!row) return null;
    if (patch.label !== undefined) {
      row.label = patch.label?.trim() || row.label;
    }
    if (patch.note !== undefined) {
      row.note = patch.note?.trim() || null;
    }
    return toDetail(await repo.save(row));
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.ds.getRepository(AnalysisReport).delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async compare(idA: number, idB: number): Promise<CompareAnalysisReportsResult | null> {
    const [a, b] = await Promise.all([this.getById(idA), this.getById(idB)]);
    if (!a || !b) return null;
    if (a.type !== b.type) {
      throw new Error('compare_type_mismatch');
    }
    return compareCryptoAlgoOptimizeReports(a, b);
  }

  private async enforceRetention(): Promise<void> {
    const repo = this.ds.getRepository(AnalysisReport);
    const cutoff = new Date(Date.now() - ANALYSIS_REPORT_MAX_AGE_MS);
    await repo
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .execute();

    const excess = await repo.count() - ANALYSIS_REPORT_MAX_COUNT;
    if (excess <= 0) return;

    const oldest = await repo.find({
      order: { createdAt: 'ASC' },
      take: excess,
      select: ['id'],
    });
    if (oldest.length === 0) return;
    await repo.delete(oldest.map((r) => r.id));
  }
}
