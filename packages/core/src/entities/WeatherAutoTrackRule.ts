import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('weather_auto_track_rules')
@Index(['enabled'])
export class WeatherAutoTrackRule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'integer', name: 'look_ahead_days', default: 1 })
  lookAheadDays!: number;

  @Column({ type: 'text', nullable: true, default: 'expand' })
  mode!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}