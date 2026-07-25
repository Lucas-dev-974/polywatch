-- Migration: Optimiser la configuration de simulation
-- Exécuter avec: psql "$DATABASE_URL" < tools/optimize-config.sql

-- 1. Sizing mode: fixed_usdc avec montant suffisant
UPDATE risk_config SET 
  sim_sizing_mode = 'fixed_usdc',
  sim_entry_usdc_amount = 10,
  sim_max_position_size_usdc = 50;

-- 2. Activer SL/TP avec valeurs raisonnables
UPDATE risk_config SET 
  sim_sl_tp_enabled = 1,
  sim_sl_percent = 5,
  sim_tp_percent = 15,
  sim_trailing_enabled = 1,
  sim_trailing_stop_percent = 10,
  sim_trailing_activation_percent = 5;

-- 3. Activer le momentum filter
UPDATE risk_config SET 
  sim_momentum_filter_enabled = 1;

-- 4. Activer signal score sizing
UPDATE risk_config SET 
  sim_signal_score_sizing_enabled = 1;

-- 5. Configurer augmentations/réductions
UPDATE risk_config SET 
  sim_copy_increase_enabled = 1,
  sim_copy_decrease_enabled = 1,
  sim_max_increases_per_position = 2,
  sim_copy_increase_sl_proximity_enabled = 1,
  sim_copy_increase_sl_proximity_percent = 80;

-- 6. Capital initial plus réaliste
UPDATE risk_config SET 
  sim_initial_capital = 500;

-- Vérification
SELECT 
  'sim_sizing_mode' as key, sim_sizing_mode as value FROM risk_config
UNION ALL
SELECT 'sim_entry_usdc_amount', CAST(sim_entry_usdc_amount AS TEXT) FROM risk_config
UNION ALL
SELECT 'sim_sl_tp_enabled', CAST(sim_sl_tp_enabled AS TEXT) FROM risk_config
UNION ALL
SELECT 'sim_sl_percent', CAST(sim_sl_percent AS TEXT) FROM risk_config
UNION ALL
SELECT 'sim_tp_percent', CAST(sim_tp_percent AS TEXT) FROM risk_config
UNION ALL
SELECT 'sim_momentum_filter_enabled', CAST(sim_momentum_filter_enabled AS TEXT) FROM risk_config
UNION ALL
SELECT 'sim_initial_capital', CAST(sim_initial_capital AS TEXT) FROM risk_config;