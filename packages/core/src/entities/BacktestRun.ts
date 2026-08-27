import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BacktestRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BacktestDomain = 'crypto' | 'weather' | 'copy';

export type BacktestMode = 'reevaluate';

@Entity('backtest_runs')
@Index(['domain', 'createdAt'])
@Index(['status'])
export class BacktestRun {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamp', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'text' })
  status!: BacktestRunStatus;

  @Column({ type: 'integer', name: 'progress_pct', default: 0 })
  progressPct!: number;

  @Column({ type: 'text' })
  domain!: BacktestDomain;

  @Column({ type: 'text' })
  mode!: BacktestMode;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'text', name: 'params_json' })
  paramsJson!: string;

  @Column({ type: 'text', name: 'config_snapshot_json', nullable: true })
  configSnapshotJson!: string | null;

  @Column({ type: 'timestamp', name: 'data_range_from', nullable: true })
  dataRangeFrom!: Date | null;

  @Column({ type: 'timestamp', name: 'data_range_to', nullable: true })
  dataRangeTo!: Date | null;

  @Column({ type: 'text', name: 'stats_json', nullable: true })
  statsJson!: string | null;

  @Column({ type: 'text', name: 'fidelity_warnings_json', nullable: true })
  fidelityWarningsJson!: string | null;

  @Column({ type: 'integer', name: 'user_id', nullable: true })
  userId!: number | null;

  @Column({ type: 'text', name: 'engine_version', nullable: true })
  engineVersion!: string | null;

  @Column({ type: 'text', name: 'config_fingerprint', nullable: true })
  configFingerprint!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
