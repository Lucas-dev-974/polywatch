import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Singleton row tracking the active real trading period (no cash ledger). */
@Entity('real_session_state')
export class RealSessionState {
  @PrimaryColumn({ type: 'integer', default: 1 })
  id!: number;

  @Column({ type: 'integer', name: 'current_session_id', nullable: true })
  currentSessionId!: number | null;

  @Column({ type: 'timestamp', name: 'period_started_at', nullable: true })
  periodStartedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
