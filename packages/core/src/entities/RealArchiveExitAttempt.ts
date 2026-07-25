import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('real_archive_exit_attempts')
@Index(['sessionId'])
export class RealArchiveExitAttempt {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'session_id' })
  sessionId!: number;

  @Column({ type: 'integer', name: 'source_id' })
  sourceId!: number;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ type: 'text', name: 'close_reason' })
  closeReason!: string;

  @Column({ type: 'text', name: 'block_reason', nullable: true })
  blockReason!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'real', name: 'mark_bid', nullable: true })
  markBid!: number | null;

  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'text', name: 'raw_json' })
  rawJson!: string;
}
