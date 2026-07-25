import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('simulation_balances')
export class SimulationBalance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', default: 'pUSD' })
  token!: string;

  @Column({ type: 'real' })
  amount!: number;

  /** Capital baseline at last reset — used to reconcile cash vs execution ledger. */
  @Column({ type: 'real', name: 'baseline_capital', nullable: true })
  baselineCapital!: number | null;

  /** Start of the current simulation session (updated on each reset). */
  @Column({ type: 'timestamp', name: 'session_started_at', nullable: true })
  sessionStartedAt!: Date | null;

  /** FK to the active simulation_sessions row. */
  @Column({ type: 'integer', name: 'current_session_id', nullable: true })
  currentSessionId!: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
