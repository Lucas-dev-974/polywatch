import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('weather_market_selections')
@Index(['conditionId'], { unique: true })
@Index(['eventSlug'])
@Index(['enabled'])
export class WeatherMarketSelection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', name: 'event_slug', nullable: true })
  eventSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'timestamp', name: 'target_date', nullable: true })
  targetDate!: Date | null;

  @Column({ type: 'text', nullable: true })
  metric!: string | null;

  @Column({ type: 'real', name: 'target_value', nullable: true })
  targetValue!: number | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}