import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type E2ePositionStatus = 'open' | 'closed';

@Entity('e2e_run_positions')
@Index(['runId'])
@Index(['conditionId'])
export class E2eRunPosition {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text', name: 'run_id' })
  runId!: string;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'market_question', nullable: true })
  marketQuestion!: string | null;

  @Column({ type: 'text', name: 'crypto_symbol', nullable: true })
  cryptoSymbol!: string | null;

  @Column({ type: 'text', nullable: true })
  interval!: string | null;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'real', name: 'entry_price' })
  entryPrice!: number;

  @Column({ type: 'real' })
  quantity!: number;

  @Column({ type: 'real', name: 'current_price', nullable: true })
  currentPrice!: number | null;

  @Column({ type: 'real', name: 'pnl_percent', nullable: true })
  pnlPercent!: number | null;

  @Column({ type: 'real', name: 'realized_pnl', nullable: true })
  realizedPnl!: number | null;

  @Column({ type: 'text' })
  status!: E2ePositionStatus;

  @Column({ type: 'text', name: 'close_reason', nullable: true })
  closeReason!: string | null;

  @Column({ type: 'timestamp', name: 'opened_at' })
  openedAt!: Date;

  @Column({ type: 'timestamp', name: 'closed_at', nullable: true })
  closedAt!: Date | null;
}