import { Column, Entity, Index, PrimaryGeneratedColumn, VersionColumn } from 'typeorm';

@Entity('executions')
@Index(['copiedPositionId', 'side', 'status'])
@Index(['status'])
@Index(['mode', 'executedAt'])
export class Execution {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'order_signal_id', unique: true })
  orderSignalId!: string;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text' })
  mode!: string;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'text', name: 'order_type', nullable: true })
  orderType!: string | null;

  @Column({ type: 'real', name: 'requested_qty', nullable: true })
  requestedQty!: number | null;

  @Column({ type: 'real', name: 'fill_price', nullable: true })
  fillPrice!: number | null;

  @Column({ type: 'real', name: 'fill_quantity', nullable: true })
  fillQuantity!: number | null;

  @Column({ type: 'real', name: 'reference_vwap', nullable: true })
  referenceVwap!: number | null;

  /**
   * Detected slippage percent at execution/guard time. Populated both for
   * filled/partial executions (derived from fill vs reference) and for
   * rejected executions (e.g. slippage_exceeded, where fillPrice is 0).
   * NULL when no referenceVwap was available (guard skipped).
   */
  @Column({ type: 'real', name: 'slippage_percent', nullable: true })
  slippagePercent!: number | null;

  @Column({ type: 'real', default: 0 })
  fees!: number;

  @Column({ type: 'real', name: 'realized_pnl', default: 0 })
  realizedPnl!: number;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'text', name: 'tx_hash', nullable: true })
  txHash!: string | null;

  @Column({ type: 'text', name: 'clob_order_id', nullable: true })
  clobOrderId!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp', name: 'executed_at', nullable: true })
  executedAt!: Date | null;

  /** Optimistic lock version — prevents double-finalisation race conditions. */
  @VersionColumn({ default: 1 })
  version!: number;
}
