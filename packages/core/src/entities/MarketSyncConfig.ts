import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('market_sync_config')
export class MarketSyncConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Max markets processed per hourly sync cycle. */
  @Column({ type: 'integer', name: 'max_markets_per_cycle', default: 10 })
  maxMarketsPerCycle!: number;

  /** Polymarket /prices-history fidelity in minutes for normal sync (1 point per N minutes). */
  @Column({ type: 'integer', name: 'default_fidelity_minutes', default: 60 })
  defaultFidelityMinutes!: number;

  /** Fidelity in minutes for the final expiration sync (finer granularity). */
  @Column({ type: 'integer', name: 'expiration_fidelity_minutes', default: 1 })
  expirationFidelityMinutes!: number;

  /** Interval in ms between hourly sync cycles. */
  @Column({ type: 'bigint', name: 'hourly_sync_interval_ms', default: 3_600_000 })
  hourlySyncIntervalMs!: number;

  /** Interval in ms between expiration sync checks. */
  @Column({ type: 'bigint', name: 'expiration_interval_ms', default: 60_000 })
  expirationIntervalMs!: number;

  /** Retention days for market price ticks (0 = no purge). */
  @Column({ type: 'integer', name: 'tick_retention_days', default: 0 })
  tickRetentionDays!: number;
}
