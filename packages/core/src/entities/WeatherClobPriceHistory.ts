import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('weather_clob_price_history')
@Index(['conditionId', 'side', 'recordedAt', 'fidelityMinutes'], { unique: true })
@Index(['city', 'targetDate', 'recordedAt'])
@Index(['ingestJobId'])
export class WeatherClobPriceHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'date', name: 'target_date' })
  targetDate!: string;

  @Column({ type: 'text' })
  metric!: string;

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

  @Column({ type: 'text' })
  side!: 'YES' | 'NO';

  @Column({ type: 'text', name: 'token_id' })
  tokenId!: string;

  @Column({ type: 'real' })
  price!: number;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;

  @Column({ type: 'integer', name: 'fidelity_minutes' })
  fidelityMinutes!: number;

  @Column({ type: 'integer', name: 'ingest_job_id', nullable: true })
  ingestJobId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
