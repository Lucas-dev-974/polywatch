import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('algo_price_ticks')
@Index(['conditionId'])
@Index(['recordedAt'])
export class AlgoPriceTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'real', name: 'up_price' })
  upPrice!: number | null;

  @Column({ type: 'real', name: 'down_price' })
  downPrice!: number | null;

  @Column({ type: 'real', name: 'up_bid', nullable: true })
  upBid!: number | null;

  @Column({ type: 'real', name: 'up_ask', nullable: true })
  upAsk!: number | null;

  @Column({ type: 'real', name: 'down_bid', nullable: true })
  downBid!: number | null;

  @Column({ type: 'real', name: 'down_ask', nullable: true })
  downAsk!: number | null;

  @Column({ type: 'real', name: 'up_spread_pct', nullable: true })
  upSpreadPct!: number | null;

  @Column({ type: 'real', name: 'down_spread_pct', nullable: true })
  downSpreadPct!: number | null;

  @Column({ type: 'real', name: 'up_ask_vwap', nullable: true })
  upAskVwap!: number | null;

  @Column({ type: 'real', name: 'down_ask_vwap', nullable: true })
  downAskVwap!: number | null;

  @Column({ type: 'text', name: 'up_liquidity_status', nullable: true })
  upLiquidityStatus!: string | null;

  @Column({ type: 'text', name: 'down_liquidity_status', nullable: true })
  downLiquidityStatus!: string | null;

  @Column({ type: 'real', name: 'price_gap', nullable: true })
  priceGap!: number | null;

  @Column({ type: 'integer', name: 'seconds_until_end', nullable: true })
  secondsUntilEnd!: number | null;

  @Column({ type: 'integer', name: 'book_staleness_ms', nullable: true })
  bookStalenessMs!: number | null;

  @Column({ type: 'boolean', name: 'ws_healthy', nullable: true })
  wsHealthy!: boolean | null;

  @Column({ type: 'real', name: 'up_bid_size', nullable: true })
  upBidSize!: number | null;

  @Column({ type: 'real', name: 'up_ask_size', nullable: true })
  upAskSize!: number | null;

  @Column({ type: 'real', name: 'down_bid_size', nullable: true })
  downBidSize!: number | null;

  @Column({ type: 'real', name: 'down_ask_size', nullable: true })
  downAskSize!: number | null;

  @Column({ type: 'real', name: 'up_last_trade_price', nullable: true })
  upLastTradePrice!: number | null;

  @Column({ type: 'real', name: 'down_last_trade_price', nullable: true })
  downLastTradePrice!: number | null;

  @Column({ type: 'real', name: 'up_last_trade_size', nullable: true })
  upLastTradeSize!: number | null;

  @Column({ type: 'real', name: 'down_last_trade_size', nullable: true })
  downLastTradeSize!: number | null;

  @Column({ type: 'real', name: 'up_delta_1s', nullable: true })
  upDelta1s!: number | null;

  @Column({ type: 'real', name: 'down_delta_1s', nullable: true })
  downDelta1s!: number | null;

  @Column({ type: 'integer', name: 'open_positions_count', default: 0 })
  openPositionsCount!: number;

  @Column({ type: 'real', name: 'open_exposure_usd', nullable: true })
  openExposureUsd!: number | null;

  @Column({ type: 'real', name: 'unrealized_pnl', nullable: true })
  unrealizedPnl!: number | null;

  @Column({ type: 'text', name: 'last_signal_outcome', nullable: true })
  lastSignalOutcome!: string | null;

  @Column({ type: 'real', name: 'last_signal_confidence', nullable: true })
  lastSignalConfidence!: number | null;

  @Column({ type: 'text', name: 'last_signal_strategy_id', nullable: true })
  lastSignalStrategyId!: string | null;

  @Column({ type: 'integer', name: 'signal_age_ms', nullable: true })
  signalAgeMs!: number | null;

  @Column({ type: 'text', name: 'last_abstain_reason', nullable: true })
  lastAbstainReason!: string | null;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
