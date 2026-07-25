import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('algo_surveillance_snapshots')
@Index(['conditionId'], { unique: true })
@Index(['marketStartAt'])
@Index(['closeCapturedAt'])
export class AlgoSurveillanceSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', nullable: true, name: 'crypto_symbol' })
  cryptoSymbol!: string | null;

  @Column({ type: 'text', nullable: true })
  interval!: string | null;

  @Column({ type: 'text', nullable: true })
  slug!: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'market_start_at' })
  marketStartAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'market_end_at' })
  marketEndAt!: Date | null;

  @Column({ type: 'real', nullable: true, name: 'open_up_price' })
  openUpPrice!: number | null;

  @Column({ type: 'real', nullable: true, name: 'open_down_price' })
  openDownPrice!: number | null;

  @Column({ type: 'timestamp', nullable: true, name: 'open_captured_at' })
  openCapturedAt!: Date | null;

  @Column({ type: 'real', nullable: true, name: 'close_up_price' })
  closeUpPrice!: number | null;

  @Column({ type: 'real', nullable: true, name: 'close_down_price' })
  closeDownPrice!: number | null;

  @Column({ type: 'timestamp', nullable: true, name: 'close_captured_at' })
  closeCapturedAt!: Date | null;

  @Column({ type: 'text', nullable: true, name: 'winning_outcome' })
  winningOutcome!: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'unresolved_at' })
  unresolvedAt!: Date | null;

  /** Frozen algo positions captured at market close (JSON array). */
  @Column({ type: 'text', name: 'positions_json', nullable: true })
  positionsJson!: string | null;

  @Column({ type: 'timestamp', name: 'positions_captured_at', nullable: true })
  positionsCapturedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
