import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SimArchivePriceCandleSource = 'algo' | 'market' | 'position';

@Entity('sim_archive_price_candles')
@Index(['sessionId', 'bucketStart'])
export class SimArchivePriceCandle {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'session_id' })
  sessionId!: number;

  @Column({ type: 'text' })
  source!: SimArchivePriceCandleSource;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id', nullable: true })
  assetId!: string | null;

  @Column({ type: 'timestamp', name: 'bucket_start' })
  bucketStart!: Date;

  @Column({ type: 'real' })
  open!: number;

  @Column({ type: 'real' })
  high!: number;

  @Column({ type: 'real' })
  low!: number;

  @Column({ type: 'real' })
  close!: number;

  @Column({ type: 'integer', name: 'tick_count', default: 0 })
  tickCount!: number;
}
