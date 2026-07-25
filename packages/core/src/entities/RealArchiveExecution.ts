import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('real_archive_executions')
@Index(['sessionId'])
export class RealArchiveExecution {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'session_id' })
  sessionId!: number;

  @Column({ type: 'integer', name: 'source_id' })
  sourceId!: number;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text' })
  side!: string;

  @Column({ type: 'real', name: 'fill_price', nullable: true })
  fillPrice!: number | null;

  @Column({ type: 'real', name: 'fill_quantity', nullable: true })
  fillQuantity!: number | null;

  @Column({ type: 'real', default: 0 })
  fees!: number;

  @Column({ type: 'real', name: 'realized_pnl', default: 0 })
  realizedPnl!: number;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'timestamp', name: 'executed_at', nullable: true })
  executedAt!: Date | null;

  @Column({ type: 'text', name: 'raw_json' })
  rawJson!: string;
}
