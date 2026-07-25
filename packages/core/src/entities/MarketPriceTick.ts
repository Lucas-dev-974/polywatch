import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Tick persisted from Polymarket price history sync (non-crypto markets). */
@Entity('market_price_ticks')
@Index(['conditionId', 'assetId', 'recordedAt'], { unique: true })
@Index(['conditionId', 'recordedAt'])
@Index(['recordedAt'])
export class MarketPriceTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id', nullable: true })
  assetId!: string | null;

  @Column({ type: 'real', name: 'best_bid', nullable: true })
  bestBid!: number | null;

  @Column({ type: 'real', name: 'best_ask', nullable: true })
  bestAsk!: number | null;

  @Column({ type: 'real', name: 'mid_price', nullable: true })
  midPrice!: number | null;

  @Column({ type: 'real', name: 'spread', nullable: true })
  spread!: number | null;

  @Column({ type: 'real', name: 'spread_percent', nullable: true })
  spreadPercent!: number | null;

  @Column({ type: 'real', name: 'executable_bid_vwap', nullable: true })
  executableBidVwap!: number | null;

  @Column({ type: 'real', name: 'executable_ask_vwap', nullable: true })
  executableAskVwap!: number | null;

  @Column({ type: 'real', name: 'last_trade_price', nullable: true })
  lastTradePrice!: number | null;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
