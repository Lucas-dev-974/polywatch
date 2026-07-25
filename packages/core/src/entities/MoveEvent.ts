import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export interface MoveSkipReasons {
  sim?: string;
  real?: string;
}

@Entity('move_events')
@Index(['traderAddress', 'conditionId', 'assetId'])
@Index(['processed'])
export class MoveEventEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text', name: 'trader_address' })
  traderAddress!: string;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text', nullable: true })
  outcome!: string | null;

  @Column({ type: 'text', name: 'event_type' })
  eventType!: string;

  @Column({ type: 'real', name: 'previous_trader_size' })
  previousTraderSize!: number;

  @Column({ type: 'real', name: 'trader_size' })
  traderSize!: number;

  @Column({ type: 'real', name: 'trader_avg_price', nullable: true })
  traderAvgPrice!: number | null;

  @Column({ type: 'integer', name: 'snapshot_seq' })
  snapshotSeq!: number;

  @Column({ type: 'boolean', default: false })
  processed!: boolean;

  @Column({ type: 'timestamp', name: 'detected_at' })
  detectedAt!: Date;

  @Column({
    type: 'simple-json',
    name: 'skip_reasons',
    nullable: true,
  })
  skipReasons!: MoveSkipReasons | null;
}
