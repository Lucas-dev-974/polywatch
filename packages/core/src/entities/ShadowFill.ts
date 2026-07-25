import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Real fill vs local FAK shadow match at the same limit price. */
@Entity('shadow_fills')
@Index(['createdAt'])
export class ShadowFill {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'signal_id' })
  signalId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'real', name: 'limit_price' })
  limitPrice!: number;

  @Column({ type: 'real', name: 'real_fill_price' })
  realFillPrice!: number;

  @Column({ type: 'real', name: 'real_fill_qty' })
  realFillQty!: number;

  @Column({ type: 'real', name: 'sim_fill_price' })
  simFillPrice!: number;

  @Column({ type: 'real', name: 'sim_fill_qty' })
  simFillQty!: number;

  @Column({ type: 'real', name: 'price_delta_pct' })
  priceDeltaPct!: number;

  @Column({ type: 'real', name: 'qty_delta_pct' })
  qtyDeltaPct!: number;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
