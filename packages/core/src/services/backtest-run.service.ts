import { DataSource, In } from 'typeorm';
import pino from 'pino';
import {
  BacktestRun,
  type BacktestDomain,
  type BacktestMode,
  type BacktestRunStatus,
} from '../entities/BacktestRun.js';
import { BacktestPosition, type BacktestExitReason } from '../entities/BacktestPosition.js';
import { BacktestEquityPoint } from '../entities/BacktestEquityPoint.js';
import { BacktestExcludedTick } from '../entities/BacktestExcludedTick.js';

const log = pino({ name: 'core:backtest-run' });

export interface BacktestRunInput {
  domain: BacktestDomain;
  mode: BacktestMode;
  paramsJson: string;
  configSnapshotJson?: string | null;
  configFingerprint?: string | null;
  engineVersion?: string | null;
  label?: string | null;
}

export interface ListBacktestRunsOptions {
  domain?: BacktestDomain | null;
  status?: BacktestRunStatus | null;
  limit?: number;
  offset?: number;
}

export interface BacktestPositionInput {
  conditionId: string;
  city?: string | null;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice?: number | null;
  entryAt: Date;
  exitAt?: Date | null;
  entryReason?: string | null;
  exitReason?: BacktestExitReason | null;
  pnl?: number | null;
  fees?: number;
  metaJson?: string | null;
}

export interface BacktestEquityPointInput {
  t: Date;
  equity: number;
  cash: number;
  openPositions: number;
}

export type BacktestExcludedReason =
  | 'market_lifecycle_filtered'
  | 'unsupported_metric_or_bucket';

export interface BacktestExcludedTickInput {
  t: Date;
  reason: BacktestExcludedReason;
  city: string | null;
  conditionId: string;
  metric: string | null;
}

export interface BacktestRunStats {
  totalPnl: number;
  pnlPct: number;
  finalEquity: number;
  maxDrawdown: number;
  winRate: number;
  /** Null means +Infinity (no losing trades) — JSON-safe. */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalTrades: number;
  avgHoldingMs: number;
  byExitReason: Record<string, number>;
  byCity: Record<string, number>;
}

export class BacktestRunService {
  constructor(private readonly ds: DataSource) {}

  get runRepo() {
    return this.ds.getRepository(BacktestRun);
  }
  get positionRepo() {
    return this.ds.getRepository(BacktestPosition);
  }
  get equityRepo() {
    return this.ds.getRepository(BacktestEquityPoint);
  }
  get excludedRepo() {
    return this.ds.getRepository(BacktestExcludedTick);
  }

  async create(input: BacktestRunInput): Promise<BacktestRun> {
    const run = this.runRepo.create({
      status: 'queued',
      progressPct: 0,
      domain: input.domain,
      mode: input.mode,
      paramsJson: input.paramsJson,
      configSnapshotJson: input.configSnapshotJson ?? null,
      configFingerprint: input.configFingerprint ?? null,
      engineVersion: input.engineVersion ?? null,
      label: input.label ?? null,
    });
    return this.runRepo.save(run);
  }

  async markStarted(id: number): Promise<void> {
    await this.runRepo.update(id, { status: 'running', startedAt: new Date() });
  }

  async updateProgress(id: number, progressPct: number): Promise<void> {
    await this.runRepo.update(id, { progressPct });
  }

  async markCompleted(
    id: number,
    stats: BacktestRunStats,
    fidelityWarnings: string[],
    dataRangeFrom: Date | null,
    dataRangeTo: Date | null,
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current || current.status === 'cancelled' || current.status === 'failed') {
      return;
    }
    await this.runRepo.update(id, {
      status: 'completed',
      finishedAt: new Date(),
      progressPct: 100,
      statsJson: JSON.stringify(stats),
      fidelityWarningsJson: JSON.stringify(fidelityWarnings),
      dataRangeFrom,
      dataRangeTo,
    });
  }

  async markFailed(id: number, error: string): Promise<void> {
    const current = await this.getById(id);
    if (!current || current.status === 'cancelled') {
      return;
    }
    await this.runRepo.update(id, {
      status: 'failed',
      finishedAt: new Date(),
      error,
    });
  }

  async markCancelled(
    id: number,
    stats?: BacktestRunStats,
    fidelityWarnings?: string[],
    dataRangeFrom?: Date | null,
    dataRangeTo?: Date | null,
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current || current.status === 'failed') {
      return;
    }
    await this.runRepo.update(id, {
      status: 'cancelled',
      finishedAt: new Date(),
      ...(stats != null ? { statsJson: JSON.stringify(stats) } : {}),
      ...(fidelityWarnings != null
        ? { fidelityWarningsJson: JSON.stringify(fidelityWarnings) }
        : {}),
      ...(dataRangeFrom !== undefined ? { dataRangeFrom } : {}),
      ...(dataRangeTo !== undefined ? { dataRangeTo } : {}),
    });
  }

  /** Runs left in 'running'/'queued' state after a backend restart are zombies. */
  async markOrphanedRunningAsFailed(): Promise<void> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'failed', finishedAt: () => 'NOW()', error: 'backend_restart' })
      .where('status IN (:...statuses)', { statuses: ['running', 'queued'] })
      .execute();
    if ((res.affected ?? 0) > 0) {
      log.warn({ affected: res.affected }, 'marked orphaned backtest runs as failed');
    }
  }

  async list(opts: ListBacktestRunsOptions): Promise<{ items: BacktestRun[]; total: number }> {
    const qb = this.runRepo.createQueryBuilder('r').orderBy('r.createdAt', 'DESC');
    if (opts.domain) {
      qb.andWhere('r.domain = :domain', { domain: opts.domain });
    }
    if (opts.status) {
      qb.andWhere('r.status = :status', { status: opts.status });
    }
    const total = await qb.clone().getCount();
    const items = await qb
      .skip(opts.offset ?? 0)
      .take(opts.limit ?? 50)
      .getMany();
    return { items, total };
  }

  async getById(id: number): Promise<BacktestRun | null> {
    return this.runRepo.findOne({ where: { id } });
  }

  async listPositions(
    runId: number,
    opts: { limit?: number; offset?: number; exitReason?: BacktestExitReason | null } = {},
  ): Promise<{ items: BacktestPosition[]; total: number }> {
    const qb = this.positionRepo
      .createQueryBuilder('p')
      .where('p.runId = :runId', { runId })
      .orderBy('p.entryAt', 'DESC');
    if (opts.exitReason) {
      qb.andWhere('p.exitReason = :exitReason', { exitReason: opts.exitReason });
    }
    const total = await qb.clone().getCount();
    const items = await qb
      .skip(opts.offset ?? 0)
      .take(opts.limit ?? 50)
      .getMany();
    return { items, total };
  }

  async listEquity(runId: number): Promise<BacktestEquityPoint[]> {
    return this.equityRepo.find({
      where: { runId },
      order: { t: 'ASC' },
    });
  }

  async appendPositions(runId: number, inputs: BacktestPositionInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((i) =>
      this.positionRepo.create({
        runId,
        conditionId: i.conditionId,
        city: i.city ?? null,
        side: i.side,
        qty: i.qty,
        entryPrice: i.entryPrice,
        exitPrice: i.exitPrice ?? null,
        entryAt: i.entryAt,
        exitAt: i.exitAt ?? null,
        entryReason: i.entryReason ?? null,
        exitReason: i.exitReason ?? null,
        pnl: i.pnl ?? null,
        fees: i.fees ?? 0,
        metaJson: i.metaJson ?? null,
      }),
    );
    await this.positionRepo.save(rows);
  }

  async appendEquity(runId: number, inputs: BacktestEquityPointInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((i) =>
      this.equityRepo.create({
        runId,
        t: i.t,
        equity: i.equity,
        cash: i.cash,
        openPositions: i.openPositions,
      }),
    );
    await this.equityRepo.save(rows);
  }

  async appendExcludedTicks(
    runId: number,
    inputs: BacktestExcludedTickInput[],
  ): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((i) =>
      this.excludedRepo.create({
        runId,
        t: i.t,
        reason: i.reason,
        city: i.city ?? null,
        conditionId: i.conditionId,
        metric: i.metric ?? null,
      }),
    );
    await this.excludedRepo.save(rows);
  }

  async listExcludedTicks(runId: number): Promise<BacktestExcludedTick[]> {
    return this.excludedRepo.find({
      where: { runId },
      order: { t: 'ASC' },
    });
  }

  async delete(runId: number): Promise<void> {
    // Positions/equity/excluded cascade on FK; explicit delete is a safety net.
    await this.excludedRepo.delete({ runId });
    await this.equityRepo.delete({ runId });
    await this.positionRepo.delete({ runId });
    await this.runRepo.delete(runId);
  }

  async hasActiveRun(domain: BacktestDomain): Promise<BacktestRun | null> {
    return this.runRepo.findOne({
      where: { domain, status: In(['running', 'queued']) },
      order: { createdAt: 'DESC' },
    });
  }
}
