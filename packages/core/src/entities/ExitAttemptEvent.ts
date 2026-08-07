import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Pre-emit block vs post-enqueue CLOB failure. */
export type ExitAttemptKind = 'emit_blocked' | 'execution_failed';

/**
 * Append-only journal of forced-exit attempts that did not execute.
 * Survives position close (unlike live counters on copied_positions).
 */
@Entity('exit_attempt_events')
@Index(['copiedPositionId', 'createdAt'])
@Index(['copiedPositionId', 'closeReason'])
export class ExitAttemptEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text', nullable: true })
  mode!: string | null;

  @Column({ type: 'text' })
  kind!: ExitAttemptKind;

  /** Forced-exit close reason (SL, TP, PRE_CLOSE_*, …). */
  @Column({ type: 'text', name: 'close_reason' })
  closeReason!: string;

  /** Pre-emit gate reason when kind = emit_blocked. */
  @Column({ type: 'text', name: 'block_reason', nullable: true })
  blockReason!: string | null;

  /** CLOB / execution error when kind = execution_failed. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** Linked executions row when kind = execution_failed. */
  @Column({ type: 'integer', name: 'execution_id', nullable: true })
  executionId!: number | null;

  /**
   * Bid mark used for the exit decision / emit attempt (0–1).
   * Null for legacy rows recorded before this column existed.
   */
  @Column({ type: 'real', name: 'mark_bid', nullable: true })
  markBid!: number | null;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
