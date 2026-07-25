import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('algo_market_selections')
@Index(['conditionId'])
@Index(['enabled'])
export class AlgoMarketSelection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', nullable: true, name: 'crypto_symbol' })
  cryptoSymbol!: string | null;

  @Column({ type: 'text', nullable: true })
  interval!: string | null;

  @Column({ type: 'text', nullable: true })
  slug!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}