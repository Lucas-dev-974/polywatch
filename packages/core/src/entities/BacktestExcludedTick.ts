import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('backtest_excluded_ticks')
@Index(['runId'])
export class BacktestExcludedTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'run_id' })
  runId!: number;

  @Column({ type: 'timestamp' })
  t!: Date;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  metric!: string | null;
}
