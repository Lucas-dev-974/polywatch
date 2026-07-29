import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('global_config')
export class GlobalConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  // ── Slippage ──────────────────────────────────────────────────────

  @Column({ type: 'real', name: 'max_slippage_percent', default: 2 })
  maxSlippagePercent!: number;

  @Column({ type: 'real', name: 'exit_slippage_guard_percent', default: 50 })
  exitSlippageGuardPercent!: number;

  // ── Real trading ──────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_trading_enabled', default: false })
  realTradingEnabled!: boolean;

  @Column({ type: 'real', name: 'real_cash_override', nullable: true })
  realCashOverride!: number | null;

  // ── Sim execution realism ─────────────────────────────────────────

  @Column({ type: 'text', name: 'sim_exec_latency_mode', nullable: true })
  simExecLatencyMode!: string | null;

  @Column({ type: 'integer', name: 'sim_exec_latency_ms', nullable: true })
  simExecLatencyMs!: number | null;

  @Column({ type: 'boolean', name: 'sim_self_impact_enabled', nullable: true })
  simSelfImpactEnabled!: boolean | null;

  @Column({ type: 'integer', name: 'sim_self_impact_ttl_seconds', nullable: true })
  simSelfImpactTtlSeconds!: number | null;

  @Column({ type: 'boolean', name: 'sim_wallet_preflight_enabled', nullable: true })
  simWalletPreflightEnabled!: boolean | null;

  @Column({ type: 'boolean', name: 'sim_shadow_logging_enabled', nullable: true })
  simShadowLoggingEnabled!: boolean | null;

  @Column({ type: 'integer', name: 'shadow_sample_retention_days', nullable: true })
  shadowSampleRetentionDays!: number | null;

  // ── Sim auto-snapshot ─────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_auto_snapshot_enabled', default: false })
  simAutoSnapshotEnabled!: boolean;

  @Column({ type: 'integer', name: 'sim_auto_snapshot_interval_seconds', default: 3600 })
  simAutoSnapshotIntervalSeconds!: number;

  @Column({ type: 'integer', name: 'sim_snapshot_max_count', nullable: true })
  simSnapshotMaxCount!: number | null;

  @Column({ type: 'integer', name: 'sim_snapshot_retention_days', nullable: true })
  simSnapshotRetentionDays!: number | null;

  @Column({ type: 'boolean', name: 'sim_auto_snapshot_empty_session', default: false })
  simAutoSnapshotEmptySession!: boolean;

  @Column({ type: 'integer', name: 'sim_snapshot_decision_window_hours', default: 24 })
  simSnapshotDecisionWindowHours!: number;

  // ── Real auto-snapshot ─────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_auto_snapshot_enabled', default: false })
  realAutoSnapshotEnabled!: boolean;

  @Column({ type: 'integer', name: 'real_auto_snapshot_interval_seconds', default: 3600 })
  realAutoSnapshotIntervalSeconds!: number;

  @Column({ type: 'integer', name: 'real_snapshot_max_count', nullable: true })
  realSnapshotMaxCount!: number | null;

  @Column({ type: 'integer', name: 'real_snapshot_retention_days', nullable: true })
  realSnapshotRetentionDays!: number | null;

  @Column({ type: 'integer', name: 'real_snapshot_decision_window_hours', default: 24 })
  realSnapshotDecisionWindowHours!: number;
}
