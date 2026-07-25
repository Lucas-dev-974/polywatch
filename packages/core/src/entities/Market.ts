import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { MarketType } from '../market/market-type.js';

@Entity('markets')
@Index(['closed', 'acceptingOrders'])
@Index(['marketType', 'active', 'closed'])
export class Market {
  @PrimaryColumn({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', nullable: true })
  slug!: string | null;

  @Column({ type: 'text', nullable: true, name: 'event_slug' })
  eventSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  icon!: string | null;

  @Column({ type: 'text', name: 'tag_slugs', default: '[]' })
  tagSlugs!: string;

  @Column({ type: 'timestamp', name: 'end_date', nullable: true })
  endDate!: Date | null;

  @Column({ type: 'text', name: 'token_id_yes', nullable: true })
  tokenIdYes!: string | null;

  @Column({ type: 'text', name: 'token_id_no', nullable: true })
  tokenIdNo!: string | null;

  /** JSON array of `{ label, tokenId, side }` — side 0 = tokenIdYes, side 1 = tokenIdNo. */
  @Column({ type: 'text', default: '[]' })
  outcomes!: string;

  @Column({ type: 'boolean', name: 'neg_risk', default: false })
  negRisk!: boolean;

  @Column({ type: 'real', name: 'fee_rate', default: 0 })
  /** Platform fee rate from CLOB `fd.r`. */
  feeRate!: number;

  /** Fee curve exponent from CLOB `fd.e`. */
  @Column({ type: 'real', name: 'fee_exponent', default: 1 })
  feeExponent!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'boolean', default: false })
  resolved!: boolean;

  @Column({ type: 'boolean', default: false })
  closed!: boolean;

  @Column({ type: 'boolean', name: 'accepting_orders', nullable: true })
  acceptingOrders!: boolean | null;

  @Column({ type: 'text', name: 'winning_token_id', nullable: true })
  winningTokenId!: string | null;

  @Column({ type: 'timestamp', name: 'updated_at', nullable: true })
  updatedAt!: Date | null;

  @Column({
    type: 'text',
    name: 'market_type',
    default: MarketType.STANDARD,
  })
  marketType!: MarketType;
}
