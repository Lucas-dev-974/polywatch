import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('trader_snapshots')
@Unique(['traderAddress', 'conditionId', 'assetId'])
export class TraderSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'trader_address' })
  traderAddress!: string;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text', nullable: true })
  outcome!: string | null;

  @Column({ type: 'real' })
  size!: number;

  @Column({ type: 'real', name: 'avg_price', nullable: true })
  avgPrice!: number | null;

  @Column({ type: 'integer', name: 'snapshot_seq' })
  snapshotSeq!: number;

  @Column({ type: 'timestamp', name: 'snapshot_at' })
  snapshotAt!: Date;
}
