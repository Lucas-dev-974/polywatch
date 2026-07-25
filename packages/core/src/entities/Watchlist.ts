import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('watchlist')
@Index(['traderAddress'])
export class WatchlistEntry {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'trader_address' })
  traderAddress!: string;

  @Column({ type: 'text', nullable: true })
  nickname!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'boolean', name: 'sim_enabled', default: true })
  simEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_enabled', default: false })
  realEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
