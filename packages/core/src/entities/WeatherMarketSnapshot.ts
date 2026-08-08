import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('weather_market_snapshots')
@Index(['cityNormalized', 'targetDateIso', 'recordedAt'])
@Index(['recordedAt'])
export class WeatherMarketSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'text', name: 'city_normalized' })
  cityNormalized!: string;

  @Column({ type: 'text', name: 'target_date_iso' })
  targetDateIso!: string;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'real', name: 'forecast_mean', nullable: true })
  forecastMean!: number | null;

  @Column({ type: 'real', name: 'forecast_std_dev', nullable: true })
  forecastStdDev!: number | null;

  @Column({ type: 'integer', name: 'bucket_count' })
  bucketCount!: number;

  @Column({ type: 'integer', name: 'total_bucket_count' })
  totalBucketCount!: number;

  @Column({ type: 'integer', name: 'rule_id', nullable: true })
  ruleId!: number | null;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;
}
