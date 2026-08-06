import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Adverse-selection mid snapshots sampled after a confirmed ALGO_OPEN fill
 * (+1s / +5s / +30s by default).
 */
@Entity('post_entry_mid_samples')
@Index(['conditionId'])
@Index(['positionId'])
@Index(['sampledAtMs'])
export class PostEntryMidSample {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'integer', name: 'position_id', nullable: true })
  positionId!: number | null;

  @Column({ type: 'bigint', name: 'filled_at_ms' })
  filledAtMs!: string;

  @Column({ type: 'integer', name: 'offset_ms' })
  offsetMs!: number;

  @Column({ type: 'real', name: 'up_mid', nullable: true })
  upMid!: number | null;

  @Column({ type: 'real', name: 'down_mid', nullable: true })
  downMid!: number | null;

  @Column({ type: 'bigint', name: 'sampled_at_ms' })
  sampledAtMs!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
