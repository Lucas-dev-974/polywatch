import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('market_price_history_sync')
@Index(['conditionId', 'assetId'], { unique: true })
@Index(['nextSyncAt'], { where: "sync_status IN ('idle','error')" })
@Index(['endDate'], { where: "sync_status != 'terminal'" })
export class MarketPriceHistorySync {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'timestamp', name: 'end_date', nullable: true })
  endDate!: Date | null;

  @Column({ type: 'timestamp', name: 'last_synced_at', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'bigint', name: 'last_point_ts', nullable: true })
  lastPointTs!: number | null;

  @Column({ type: 'text', name: 'sync_status', default: 'idle' })
  syncStatus!: string;

  @Column({ type: 'timestamp', name: 'next_sync_at', nullable: true })
  nextSyncAt!: Date | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
