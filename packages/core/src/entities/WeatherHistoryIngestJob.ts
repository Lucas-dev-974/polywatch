import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type WeatherHistoryIngestJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

@Entity('weather_history_ingest_jobs')
@Index(['city', 'status'])
@Index(['createdAt'])
export class WeatherHistoryIngestJob {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'date', name: 'from_date' })
  fromDate!: string;

  @Column({ type: 'date', name: 'to_date' })
  toDate!: string;

  @Column({ type: 'integer', name: 'fidelity_minutes' })
  fidelityMinutes!: number;

  @Column({ type: 'text', default: 'pending' })
  status!: WeatherHistoryIngestJobStatus;

  @Column({ type: 'integer', name: 'markets_total', default: 0 })
  marketsTotal!: number;

  @Column({ type: 'integer', name: 'markets_done', default: 0 })
  marketsDone!: number;

  @Column({ type: 'integer', name: 'markets_empty', default: 0 })
  marketsEmpty!: number;

  @Column({ type: 'integer', name: 'points_upserted', default: 0 })
  pointsUpserted!: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamp', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
