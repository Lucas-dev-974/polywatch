import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('trader_snapshot_seq')
export class TraderSnapshotSeq {
  @PrimaryColumn({ type: 'text', name: 'trader_address' })
  traderAddress!: string;

  @Column({ type: 'integer', default: 0 })
  seq!: number;
}
