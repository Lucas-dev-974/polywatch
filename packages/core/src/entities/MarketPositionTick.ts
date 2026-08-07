import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tick persisted each time a book update is received for an asset that has at
 * least one open **copy or weather** position (worker `MarketTickRecorder`).
 *
 * Crypto-algo positions are excluded: their BBO series lives in `algo_price_ticks`
 * (crypto-algo `PriceTickRecorder` at ~1 Hz). Keeping both would be redundant.
 */
@Entity('market_position_ticks')
@Index(['copiedPositionId'])
@Index(['conditionId', 'createdAt'])
@Index(['assetId', 'createdAt'])
@Index(['createdAt'])
export class MarketPositionTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'real', name: 'best_bid' })
  bestBid!: number;

  @Column({ type: 'real', name: 'best_ask' })
  bestAsk!: number;

  /** Mid price derived at insert time: (bestBid + bestAsk) / 2. */
  @Column({ type: 'real', name: 'mid_price' })
  midPrice!: number;

  /** Top-of-book spread derived at insert time: bestAsk - bestBid. */
  @Column({ type: 'real', name: 'spread' })
  spread!: number;

  /** Spread expressed as a fraction of the mid price. */
  @Column({ type: 'real', name: 'spread_percent' })
  spreadPercent!: number;

  /** VWAP bid for a reference quantity. */
  @Column({ type: 'real', name: 'executable_bid_vwap', nullable: true })
  executableBidVwap!: number | null;

  /** VWAP ask for a reference quantity. */
  @Column({ type: 'real', name: 'executable_ask_vwap', nullable: true })
  executableAskVwap!: number | null;

  /** Last trade price received from the WebSocket feed. */
  @Column({ type: 'real', name: 'last_trade_price', nullable: true })
  lastTradePrice!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
