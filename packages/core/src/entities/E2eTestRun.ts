import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type E2eRunStatus = 'running' | 'passed' | 'failed' | 'cancelled';

export type E2eSuiteId =
  | 'playwright'
  | 'crypto-algo'
  | 'crypto-algo-real'
  | 'compliance';

export interface E2eTestCaseLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface E2eTestCaseSummary {
  /** Full name (describe chain + it title). Kept for backward compatibility. */
  name: string;
  /** `it(...)` title. */
  title?: string;
  /** `describe(...)` chain, e.g. "crypto-algo e2e". */
  description?: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  durationMs?: number;
  /** Assertion / stack messages. Omitted when empty. */
  failureMessages?: string[];
  location?: E2eTestCaseLocation;
}

export interface E2eRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests?: E2eTestCaseSummary[];
}

@Entity('e2e_test_runs')
@Index(['startedAt'])
@Index(['status'])
export class E2eTestRun {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  suite!: E2eSuiteId;

  @Column({ type: 'text' })
  status!: E2eRunStatus;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamp', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'integer', name: 'duration_ms', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'integer', name: 'exit_code', nullable: true })
  exitCode!: number | null;

  @Column({ type: 'simple-json', nullable: true })
  summary!: E2eRunSummary | null;

  @Column({ type: 'text', name: 'log_file_path' })
  logFilePath!: string;

  @Column({ type: 'text', name: 'triggered_by', nullable: true })
  triggeredBy!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;
}
