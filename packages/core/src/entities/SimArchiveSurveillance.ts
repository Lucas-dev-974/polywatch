import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sim_archive_surveillance')
@Index(['sessionId'])
export class SimArchiveSurveillance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'session_id' })
  sessionId!: number;

  @Column({ type: 'integer', name: 'source_id' })
  sourceId!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', name: 'crypto_symbol', nullable: true })
  cryptoSymbol!: string | null;

  @Column({ type: 'text', nullable: true })
  interval!: string | null;

  @Column({ type: 'text', nullable: true })
  slug!: string | null;

  @Column({ type: 'timestamp', name: 'market_start_at', nullable: true })
  marketStartAt!: Date | null;

  @Column({ type: 'timestamp', name: 'market_end_at', nullable: true })
  marketEndAt!: Date | null;

  @Column({ type: 'real', name: 'open_up_price', nullable: true })
  openUpPrice!: number | null;

  @Column({ type: 'real', name: 'open_down_price', nullable: true })
  openDownPrice!: number | null;

  @Column({ type: 'real', name: 'close_up_price', nullable: true })
  closeUpPrice!: number | null;

  @Column({ type: 'real', name: 'close_down_price', nullable: true })
  closeDownPrice!: number | null;

  @Column({ type: 'text', name: 'winning_outcome', nullable: true })
  winningOutcome!: string | null;

  @Column({ type: 'text', name: 'positions_json', nullable: true })
  positionsJson!: string | null;

  @Column({ type: 'text', name: 'raw_json' })
  rawJson!: string;
}
