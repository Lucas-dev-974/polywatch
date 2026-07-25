import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('copied_positions')
@Index(['status', 'mode'])
@Index(['conditionId'])
@Index(['status', 'closingStartedAt'])
@Index(['watchlistId', 'conditionId', 'assetId', 'mode', 'status'])
export class CopiedPosition {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'watchlist_id' })
  watchlistId!: number;

  @Column({ type: 'text', name: 'move_event_id', nullable: true })
  moveEventId!: string | null;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'text', default: 'BUY' })
  side!: string;

  @Column({ type: 'real' })
  quantity!: number;

  @Column({ type: 'real', name: 'entry_price' })
  entryPrice!: number;

  @Column({ type: 'real', name: 'entry_bid_vwap' })
  entryBidVwap!: number;

  @Column({ type: 'real', name: 'entry_fees', default: 0 })
  entryFees!: number;

  @Column({ type: 'real', name: 'entry_quantity_remaining', nullable: true })
  entryQuantityRemaining!: number | null;

  @Column({ type: 'real', name: 'entry_fees_remaining', default: 0 })
  entryFeesRemaining!: number;

  @Column({ type: 'real', name: 'executable_bid_vwap', nullable: true })
  executableBidVwap!: number | null;

  /** Last observed executable or WS bid usable for pre-close (never overwritten with 0). */
  @Column({ type: 'real', name: 'last_closeable_bid_vwap', nullable: true })
  lastCloseableBidVwap!: number | null;

  @Column({ type: 'timestamp', name: 'last_closeable_bid_at', nullable: true })
  lastCloseableBidAt!: Date | null;

  @Column({ type: 'real', name: 'unrealized_pnl', default: 0 })
  unrealizedPnl!: number;

  @Column({ type: 'real', name: 'realized_pnl', default: 0 })
  realizedPnl!: number;

  @Column({ type: 'real', name: 'peak_closure_pnl_percent', nullable: true })
  peakClosurePnlPercent!: number | null;

  @Column({ type: 'integer', name: 'closing_attempt_seq', default: 0 })
  closingAttemptSeq!: number;

  @Column({ type: 'text', name: 'liquidity_status', default: 'ok' })
  liquidityStatus!: string;

  @Column({ type: 'timestamp', name: 'book_updated_at', nullable: true })
  bookUpdatedAt!: Date | null;

  @Column({ type: 'real', name: 'peak_bid_vwap', nullable: true })
  peakBidVwap!: number | null;

  @Column({ type: 'real', name: 'trailing_bid_points', nullable: true })
  trailingBidPoints!: number | null;

  @Column({ type: 'real', name: 'trailing_activation_bid_points', nullable: true })
  trailingActivationBidPoints!: number | null;

  @Column({ type: 'text', default: 'open' })
  status!: string;

  @Column({ type: 'text' })
  mode!: string;

  @Column({ type: 'timestamp', name: 'opened_at', nullable: true })
  openedAt!: Date | null;

  @Column({ type: 'timestamp', name: 'closed_at', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'text', name: 'close_reason', nullable: true })
  closeReason!: string | null;

  /** Exit reason set when beginClose starts; cleared on revertClose or final close. */
  @Column({ type: 'text', name: 'closing_reason', nullable: true })
  closingReason!: string | null;

  @Column({ type: 'timestamp', name: 'closing_started_at', nullable: true })
  closingStartedAt!: Date | null;

  @Column({ type: 'integer', name: 'increase_count', default: 0 })
  increaseCount!: number;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** Stop-loss threshold in bid points (absolute) for binary markets. */
  @Column({ type: 'real', name: 'sl_bid_points', nullable: true })
  slBidPoints!: number | null;

  /** Take-profit threshold in bid points (absolute) for binary markets. */
  @Column({ type: 'real', name: 'tp_bid_points', nullable: true })
  tpBidPoints!: number | null;

  /** Failed CLOB exit attempts for SL/TP/trailing/pre-close/time-exit. */
  @Column({ type: 'integer', name: 'forced_exit_failed_attempts', default: 0 })
  forcedExitFailedAttempts!: number;

  /** Timestamp of the last forced exit attempt (emit or failed execution). */
  @Column({
    type: 'timestamp',
    name: 'last_forced_exit_attempt_at',
    nullable: true,
  })
  lastForcedExitAttemptAt!: Date | null;

  /** Why the last decided forced-exit was not enqueued (pre-emit gate). */
  @Column({ type: 'text', name: 'last_exit_block_reason', nullable: true })
  lastExitBlockReason!: string | null;

  /** Close reason that was blocked at emit time (SL, TIME_EXIT, …). */
  @Column({
    type: 'text',
    name: 'last_exit_block_close_reason',
    nullable: true,
  })
  lastExitBlockCloseReason!: string | null;

  /** Start of the current pre-emit block episode (for persistence alerts). */
  @Column({
    type: 'timestamp',
    name: 'first_exit_block_at',
    nullable: true,
  })
  firstExitBlockAt!: Date | null;

  /** Last time a pre-emit block was observed. */
  @Column({
    type: 'timestamp',
    name: 'last_exit_block_at',
    nullable: true,
  })
  lastExitBlockAt!: Date | null;

  /** Throttled count of pre-emit block observations. */
  @Column({ type: 'integer', name: 'exit_emit_blocked_count', default: 0 })
  exitEmitBlockedCount!: number;
}
