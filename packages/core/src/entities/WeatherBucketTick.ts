import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('weather_bucket_ticks')
@Index(['snapshotId'])
@Index(['conditionId', 'recordedAt'])
@Index(['recordedAt'])
@Index(['cityNormalized', 'targetDateIso', 'recordedAt'])
export class WeatherBucketTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'snapshot_id' })
  snapshotId!: number;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'text', name: 'city_normalized', nullable: true })
  cityNormalized!: string | null;

  @Column({ type: 'text', name: 'target_date_iso', nullable: true })
  targetDateIso!: string | null;

  @Column({ type: 'text', nullable: true })
  metric!: string | null;

  @Column({ type: 'integer', name: 'fidelity_minutes', nullable: true })
  fidelityMinutes!: number | null;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'event_slug', nullable: true })
  eventSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', name: 'bucket_comparison', nullable: true })
  bucketComparison!: string | null;

  @Column({ type: 'real', name: 'bucket_target', nullable: true })
  bucketTarget!: number | null;

  @Column({ type: 'real', name: 'bucket_low', nullable: true })
  bucketLow!: number | null;

  @Column({ type: 'real', name: 'bucket_high', nullable: true })
  bucketHigh!: number | null;

  @Column({ type: 'real', name: 'yes_price', nullable: true })
  yesPrice!: number | null;

  @Column({ type: 'real', name: 'no_price', nullable: true })
  noPrice!: number | null;

  @Column({ type: 'text', name: 'yes_token_id', nullable: true })
  yesTokenId!: string | null;

  @Column({ type: 'text', name: 'no_token_id', nullable: true })
  noTokenId!: string | null;

  @Column({ type: 'real', nullable: true })
  volume!: number | null;

  @Column({ type: 'real', name: 'volume_24hr', nullable: true })
  volume24hr!: number | null;

  @Column({ type: 'real', name: 'liquidity_clob', nullable: true })
  liquidityClob!: number | null;

  @Column({ type: 'boolean', name: 'accepting_orders', nullable: true })
  acceptingOrders!: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  closed!: boolean | null;

  @Column({ type: 'timestamp', name: 'end_date', nullable: true })
  endDate!: Date | null;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;
}
