import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('real_archive_positions')
@Index(['sessionId'])
export class RealArchivePosition {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'session_id' })
  sessionId!: number;

  @Column({ type: 'integer', name: 'source_id' })
  sourceId!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text', name: 'market_title', nullable: true })
  marketTitle!: string | null;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'real' })
  size!: number;

  @Column({ type: 'real', name: 'entry_price' })
  entryPrice!: number;

  @Column({ type: 'real', name: 'exit_price', nullable: true })
  exitPrice!: number | null;

  @Column({ type: 'real', name: 'realized_pnl', default: 0 })
  realizedPnl!: number;

  @Column({ type: 'text', name: 'close_reason', nullable: true })
  closeReason!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamp', name: 'opened_at', nullable: true })
  openedAt!: Date | null;

  @Column({ type: 'timestamp', name: 'closed_at', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'text', name: 'raw_json' })
  rawJson!: string;
}
