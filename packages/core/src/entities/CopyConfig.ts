import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';

@Entity('copy_config')
export class CopyConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  // ── Friction: position limits (sim/real) ──────────────────────────

  @Column({ type: 'integer', name: 'sim_max_open_positions', default: 10 })
  simMaxOpenPositions!: number;

  @Column({ type: 'integer', name: 'real_max_open_positions', default: 10 })
  realMaxOpenPositions!: number;

  @Column({ type: 'real', name: 'sim_max_exposure_usdc', default: 1000 })
  simMaxExposureUsdc!: number;

  @Column({ type: 'real', name: 'real_max_exposure_usdc', default: 1000 })
  realMaxExposureUsdc!: number;

  @Column({ type: 'real', name: 'sim_max_daily_loss_usdc', default: 100 })
  simMaxDailyLossUsdc!: number;

  @Column({ type: 'real', name: 'real_max_daily_loss_usdc', default: 100 })
  realMaxDailyLossUsdc!: number;

  @Column({ type: 'real', name: 'sim_max_position_size_usdc', default: 200 })
  simMaxPositionSizeUsdc!: number;

  @Column({ type: 'real', name: 'real_max_position_size_usdc', default: 200 })
  realMaxPositionSizeUsdc!: number;

  // ── Bid/ask ratio gates ───────────────────────────────────────────

  @Column({ type: 'real', name: 'sim_min_bid_to_ask_ratio', default: 0.9 })
  simMinBidToAskRatio!: number;

  @Column({ type: 'real', name: 'real_min_bid_to_ask_ratio', default: 0.9 })
  realMinBidToAskRatio!: number;

  // ── Momentum filter ────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_momentum_filter_enabled', default: false })
  simMomentumFilterEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_momentum_filter_enabled', default: false })
  realMomentumFilterEnabled!: boolean;

  // ── Copy trading master toggles ───────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_copy_trading_enabled', default: true })
  simCopyTradingEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_copy_trading_enabled', default: true })
  realCopyTradingEnabled!: boolean;

  // ── Sizing (sim) ──────────────────────────────────────────────────

  @Column({ type: 'text', name: 'sim_sizing_mode', default: 'fixed_usdc' })
  simSizingMode!: string;

  @Column({ type: 'real', name: 'sim_copy_ratio', default: 1.0 })
  simCopyRatio!: number;

  @Column({ type: 'real', name: 'sim_entry_usdc_amount', default: 10 })
  simEntryUsdcAmount!: number;

  @Column({ type: 'integer', name: 'sim_entry_share_count', default: 5 })
  simEntryShareCount!: number;

  @Column({ type: 'real', name: 'sim_kelly_fraction', default: 0.25 })
  simKellyFraction!: number;

  @Column({ type: 'real', name: 'sim_risk_budget_usdc', default: 10 })
  simRiskBudgetUsdc!: number;

  @Column({ type: 'real', name: 'sim_default_win_probability', default: 0.55 })
  simDefaultWinProbability!: number;

  // ── Sizing (real) ─────────────────────────────────────────────────

  @Column({ type: 'text', name: 'real_sizing_mode', default: 'fixed_usdc' })
  realSizingMode!: string;

  @Column({ type: 'real', name: 'real_copy_ratio', default: 1.0 })
  realCopyRatio!: number;

  @Column({ type: 'real', name: 'real_entry_usdc_amount', default: 10 })
  realEntryUsdcAmount!: number;

  @Column({ type: 'integer', name: 'real_entry_share_count', default: 5 })
  realEntryShareCount!: number;

  @Column({ type: 'real', name: 'real_kelly_fraction', default: 0.25 })
  realKellyFraction!: number;

  @Column({ type: 'real', name: 'real_risk_budget_usdc', default: 10 })
  realRiskBudgetUsdc!: number;

  @Column({ type: 'real', name: 'real_default_win_probability', default: 0.55 })
  realDefaultWinProbability!: number;

  // ── Trailing (sim) ────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_trailing_enabled', default: true })
  simTrailingEnabled!: boolean;

  @Column({ type: 'real', name: 'sim_trailing_percent', default: 10 })
  simTrailingPercent!: number;

  @Column({ type: 'real', name: 'sim_trailing_activation_percent', default: 12 })
  simTrailingActivationPercent!: number;

  // ── Trailing (real) ───────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_trailing_enabled', default: true })
  realTrailingEnabled!: boolean;

  @Column({ type: 'real', name: 'real_trailing_percent', default: 10 })
  realTrailingPercent!: number;

  @Column({ type: 'real', name: 'real_trailing_activation_percent', default: 12 })
  realTrailingActivationPercent!: number;

  // ── SL/TP toggles (sim) ───────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_sl_enabled', default: true })
  simSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'sim_tp_enabled', default: true })
  simTpEnabled!: boolean;

  // ── SL/TP toggles (real) ──────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_sl_enabled', default: true })
  realSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_tp_enabled', default: true })
  realTpEnabled!: boolean;

  // ── SL/TP percent (sim) ─────────────────────────────────────────

  @Column({ type: 'real', name: 'sim_sl_percent', default: 20 })
  simSlPercent!: number;

  @Column({ type: 'real', name: 'sim_tp_percent', default: 25 })
  simTpPercent!: number;

  // ── SL/TP percent (real) ───────────────────────────────────────

  @Column({ type: 'real', name: 'real_sl_percent', default: 20 })
  realSlPercent!: number;

  @Column({ type: 'real', name: 'real_tp_percent', default: 25 })
  realTpPercent!: number;

  // ── SL close max retries ──────────────────────────────────────────

  @Column({ type: 'integer', name: 'sim_sl_close_max_retries', default: 5 })
  simSlCloseMaxRetries!: number;

  @Column({ type: 'integer', name: 'real_sl_close_max_retries', default: 5 })
  realSlCloseMaxRetries!: number;

  // ── Entry depth retry ───────────────────────────────────────────────

  @Column({ type: 'integer', name: 'sim_entry_depth_retry_max', default: 3 })
  simEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'sim_entry_depth_retry_delay_ms', default: 1000 })
  simEntryDepthRetryDelayMs!: number;

  @Column({ type: 'integer', name: 'real_entry_depth_retry_max', default: 3 })
  realEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'real_entry_depth_retry_delay_ms', default: 1000 })
  realEntryDepthRetryDelayMs!: number;

  // ── Kill-switch (sim/real) ────────────────────────────────────────

  @Column({ type: 'text', name: 'sim_kill_switch_action', default: 'block_entries' })
  simKillSwitchAction!: string;

  @Column({ type: 'text', name: 'real_kill_switch_action', default: 'block_entries' })
  realKillSwitchAction!: string;

  // ── Copy increase / decrease toggles (sim) ────────────────────────

  @Column({ type: 'boolean', name: 'sim_copy_increase_enabled', default: true })
  simCopyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'sim_copy_decrease_enabled', default: true })
  simCopyDecreaseEnabled!: boolean;

  // ── Copy increase / decrease toggles (real) ────────────────────────

  @Column({ type: 'boolean', name: 'real_copy_increase_enabled', default: true })
  realCopyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_copy_decrease_enabled', default: true })
  realCopyDecreaseEnabled!: boolean;

  // ── Max increases per position ────────────────────────────────────

  @Column({ type: 'integer', name: 'sim_max_increases_per_position', default: 1 })
  simMaxIncreasesPerPosition!: number;

  @Column({ type: 'integer', name: 'real_max_increases_per_position', default: 0 })
  realMaxIncreasesPerPosition!: number;

  // ── SL proximity guard (sim) ───────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_copy_increase_sl_proximity_enabled', default: true })
  simCopyIncreaseSlProximityEnabled!: boolean;

  @Column({ type: 'real', name: 'sim_copy_increase_sl_proximity_percent', default: 80 })
  simCopyIncreaseSlProximityPercent!: number;

  // ── SL proximity guard (real) ──────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_copy_increase_sl_proximity_enabled', default: false })
  realCopyIncreaseSlProximityEnabled!: boolean;

  @Column({ type: 'real', name: 'real_copy_increase_sl_proximity_percent', default: 80 })
  realCopyIncreaseSlProximityPercent!: number;

  // ── Pre-close (sim) ───────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_pre_close_enabled', default: true })
  simPreCloseEnabled!: boolean;

  @Column({ type: 'integer', name: 'sim_pre_close_seconds', default: 60 })
  simPreCloseSeconds!: number;

  // ── Pre-close (real) ──────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_pre_close_enabled', default: true })
  realPreCloseEnabled!: boolean;

  @Column({ type: 'integer', name: 'real_pre_close_seconds', default: 60 })
  realPreCloseSeconds!: number;

  // ── Min time to close ──────────────────────────────────────────────

  @Column({ type: 'integer', name: 'sim_min_time_to_close', default: 0 })
  simMinTimeToClose!: number;

  @Column({ type: 'integer', name: 'real_min_time_to_close', default: 0 })
  realMinTimeToClose!: number;

  // ── Pre-close keep (sim) ──────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_pre_close_keep_enabled', default: false })
  simPreCloseKeepEnabled!: boolean;

  @Column({ type: 'real', name: 'sim_pre_close_keep_bid_threshold', default: 0.80 })
  simPreCloseKeepBidThreshold!: number;

  // ── Pre-close keep (real) ─────────────────────────────────────────

  @Column({ type: 'boolean', name: 'real_pre_close_keep_enabled', default: false })
  realPreCloseKeepEnabled!: boolean;

  @Column({ type: 'real', name: 'real_pre_close_keep_bid_threshold', default: 0.80 })
  realPreCloseKeepBidThreshold!: number;

  // ── Allowed market tags ───────────────────────────────────────────

  @Column({ type: 'text', name: 'sim_allowed_market_tags', default: '[]' })
  simAllowedMarketTags!: string;

  @Column({ type: 'text', name: 'real_allowed_market_tags', default: '[]' })
  realAllowedMarketTags!: string;

  // ── Signal score sizing ───────────────────────────────────────────

  @Column({ type: 'boolean', name: 'sim_signal_score_sizing_enabled', default: true })
  simSignalScoreSizingEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_signal_score_sizing_enabled', default: true })
  realSignalScoreSizingEnabled!: boolean;

  // ── Sim initial capital (copy) ─────────────────────────────────────

  @Column({
    type: 'real',
    name: 'sim_initial_capital_copy',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalCopy!: number;

  // ── Non-prefixed copy-level fields ────────────────────────────────

  @Column({ type: 'boolean', name: 'copy_increase_enabled', default: true })
  copyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'copy_decrease_enabled', default: true })
  copyDecreaseEnabled!: boolean;

  @Column({ type: 'integer', name: 'max_increases_per_position', default: 0 })
  maxIncreasesPerPosition!: number;

  @Column({ type: 'boolean', name: 'pre_close_enabled', default: true })
  preCloseEnabled!: boolean;

  @Column({ type: 'integer', name: 'pre_close_seconds', default: 60 })
  preCloseSeconds!: number;

  @Column({ type: 'text', name: 'kill_switch_action', default: 'block_entries' })
  killSwitchAction!: string;

  @Column({ type: 'integer', name: 'sl_confirmation_ticks', default: 2 })
  slConfirmationTicks!: number;

  @Column({ type: 'integer', name: 'move_detector_interval_ms', default: 2_000 })
  moveDetectorIntervalMs!: number;
}
