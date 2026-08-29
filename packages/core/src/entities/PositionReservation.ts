import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('position_reservations')
@Index(['expiresAt'])
@Index(['mode', 'expiresAt'])
export class PositionReservation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'order_signal_id', unique: true })
  orderSignalId!: string;

  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'integer', name: 'watchlist_id' })
  watchlistId!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id' })
  assetId!: string;

  @Column({ type: 'text' })
  mode!: string;

  @Column({ type: 'real', name: 'reserved_notional_pusd' })
  reservedNotionalPusd!: number;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;
}
