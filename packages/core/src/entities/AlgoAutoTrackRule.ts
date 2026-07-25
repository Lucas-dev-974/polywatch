import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('algo_auto_track_rules')
@Index(['cryptoSymbol', 'interval'], { unique: true })
@Index(['enabled'])
export class AlgoAutoTrackRule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'crypto_symbol' })
  cryptoSymbol!: string;

  @Column({ type: 'text' })
  interval!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
