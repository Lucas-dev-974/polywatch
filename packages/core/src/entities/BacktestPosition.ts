import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { BacktestExitReason } from '../backtest/backtest-exit-reasons.js';

export { BACKTEST_EXIT_REASONS, EXIT_REASON_LABEL } from '../backtest/backtest-exit-reasons.js';
export type { BacktestExitReason } from '../backtest/backtest-exit-reasons.js';

@Entity('backtest_positions')
@Index(['runId'])
@Index(['runId', 'exitReason'])
export class BacktestPosition {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'run_id' })
  runId!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'real' })
  qty!: number;

  @Column({ type: 'real', name: 'entry_price' })
  entryPrice!: number;

  @Column({ type: 'real', name: 'exit_price', nullable: true })
  exitPrice!: number | null;

  @Column({ type: 'timestamp', name: 'entry_at' })
  entryAt!: Date;

  @Column({ type: 'timestamp', name: 'exit_at', nullable: true })
  exitAt!: Date | null;

  @Column({ type: 'text', name: 'entry_reason', nullable: true })
  entryReason!: string | null;

  @Column({ type: 'text', name: 'exit_reason', nullable: true })
  exitReason!: BacktestExitReason | null;

  @Column({ type: 'real', nullable: true })
  pnl!: number | null;

  @Column({ type: 'real', default: 0 })
  fees!: number;

  @Column({ type: 'text', name: 'meta_json', nullable: true })
  metaJson!: string | null;
}
