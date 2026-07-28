import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { SimAlgoKind } from '../simulation/algo-kind.js';

@Entity('simulation_state_snapshots')
@Index('idx_sim_snapshots_source_created', ['source', 'createdAt'])
@Index('idx_sim_snapshots_created', ['createdAt'])
export class SimulationStateSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'text' })
  source!: 'manual' | 'reset' | 'auto' | 'config_change';

  @Column({ type: 'integer', name: 'session_id', nullable: true })
  sessionId!: number | null;

  /** Algo perimeter this snapshot belongs to. */
  @Column({ type: 'text', name: 'algo_kind', nullable: true })
  algoKind!: SimAlgoKind | null;

  @Column({ type: 'real' })
  amount!: number;

  @Column({ type: 'text', default: 'pUSD' })
  token!: string;

  @Column({ type: 'real', name: 'positions_value' })
  positionsValue!: number;

  @Column({ type: 'real' })
  equity!: number;

  @Column({ type: 'real', name: 'open_pnl_sum' })
  openPnlSum!: number;

  @Column({ type: 'real', name: 'closed_pnl_sum' })
  closedPnlSum!: number;

  @Column({ type: 'real', name: 'baseline_capital' })
  baselineCapital!: number;

  @Column({ type: 'integer', name: 'position_count' })
  positionCount!: number;

  @Column({ type: 'integer', name: 'open_position_count' })
  openPositionCount!: number;

  @Column({ type: 'integer', name: 'closed_position_count' })
  closedPositionCount!: number;

  @Column({ type: 'integer', name: 'execution_count' })
  executionCount!: number;

  @Column({ type: 'integer', name: 'trader_count' })
  traderCount!: number;

  @Column({ type: 'text', name: 'traders_label' })
  tradersLabel!: string;

  @Column({ type: 'text', name: 'traders_json' })
  tradersJson!: string;

  @Column({ type: 'text', name: 'positions_json' })
  positionsJson!: string;

  @Column({ type: 'text', name: 'executions_json' })
  executionsJson!: string;

  @Column({ type: 'text', name: 'exit_attempts_json', nullable: true })
  exitAttemptsJson!: string | null;

  @Column({ type: 'text', name: 'move_events_json', nullable: true })
  moveEventsJson!: string | null;

  @Column({ type: 'text', name: 'decision_summary_json', nullable: true })
  decisionSummaryJson!: string | null;
}
