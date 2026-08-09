import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('backtest_equity_points')
@Index(['runId'])
export class BacktestEquityPoint {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'run_id' })
  runId!: number;

  @Column({ type: 'timestamp' })
  t!: Date;

  @Column({ type: 'real' })
  equity!: number;

  @Column({ type: 'real' })
  cash!: number;

  @Column({ type: 'integer', name: 'open_positions', default: 0 })
  openPositions!: number;
}
