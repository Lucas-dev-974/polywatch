import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('weather_evaluation_log')
@Index(['snapshotId'])
@Index(['conditionId', 'evaluatedAt'])
@Index(['strategyId', 'evaluatedAt'])
@Index(['evaluatedAt'])
export class WeatherEvaluationLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'snapshot_id', nullable: true })
  snapshotId!: number | null;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'bucket_comparison', nullable: true })
  bucketComparison!: string | null;

  @Column({ type: 'real', name: 'bucket_target', nullable: true })
  bucketTarget!: number | null;

  @Column({ type: 'real', name: 'bucket_low', nullable: true })
  bucketLow!: number | null;

  @Column({ type: 'real', name: 'bucket_high', nullable: true })
  bucketHigh!: number | null;

  @Column({ type: 'text', name: 'strategy_id' })
  strategyId!: string;

  @Column({ type: 'real', name: 'yes_price', nullable: true })
  yesPrice!: number | null;

  @Column({ type: 'real', name: 'forecast_prob', nullable: true })
  forecastProb!: number | null;

  @Column({ type: 'real', nullable: true })
  edge!: number | null;

  @Column({ type: 'real', name: 'dynamic_min_edge', nullable: true })
  dynamicMinEdge!: number | null;

  @Column({ type: 'text' })
  decision!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamp', name: 'evaluated_at' })
  evaluatedAt!: Date;
}
