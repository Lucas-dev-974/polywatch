import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SimulationSessionStatus = 'active' | 'closed';

@Entity('simulation_sessions')
@Index('idx_sim_sessions_status_started', ['status', 'startedAt'])
@Index('idx_sim_sessions_started', ['startedAt'])
export class SimulationSession {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamp', name: 'ended_at', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'text', default: 'active' })
  status!: SimulationSessionStatus;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'real', name: 'baseline_capital' })
  baselineCapital!: number;

  @Column({ type: 'real', name: 'ending_equity', nullable: true })
  endingEquity!: number | null;

  @Column({ type: 'real', name: 'ending_session_pnl', nullable: true })
  endingSessionPnl!: number | null;

  @Column({ type: 'integer', name: 'snapshot_count', default: 0 })
  snapshotCount!: number;

  @Column({ type: 'real', name: 'peak_equity', nullable: true })
  peakEquity!: number | null;

  @Column({ type: 'real', name: 'trough_equity', nullable: true })
  troughEquity!: number | null;

  @Column({ type: 'text', name: 'config_json', nullable: true })
  configJson!: string | null;

  @Column({ type: 'text', name: 'archive_summary_json', nullable: true })
  archiveSummaryJson!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
