/**
 * Raisons de sortie backtest — source unique, sans dépendance typeorm.
 * Extraites de `BacktestPosition` pour être importables côté frontend sans
 * tirer les décorateurs typeorm dans le bundle (R3).
 */
export const BACKTEST_EXIT_REASONS = [
  'SL',
  'TP',
  'TRAILING',
  'RESOLUTION',
  'STRATEGY_FLIP',
  'WINDOW_CLOSE',
  'KILL_SWITCH',
  'WEATHER_PRE_CLOSE',
  'WEATHER_FORECAST_CHANGE',
  'WEATHER_BUCKET_EXIT',
] as const;

export type BacktestExitReason = (typeof BACKTEST_EXIT_REASONS)[number];

/** Libellés d'affichage des raisons de sortie (frontend). */
export const EXIT_REASON_LABEL: Record<string, string> = {
  SL: 'Stop loss',
  TP: 'Take profit',
  TRAILING: 'Trailing',
  RESOLUTION: 'Résolution',
  KILL_SWITCH: 'Kill-switch',
  WEATHER_PRE_CLOSE: 'Pré-close',
  WEATHER_FORECAST_CHANGE: 'Dérive forecast',
  WEATHER_BUCKET_EXIT: 'Sortie de bucket',
  STRATEGY_FLIP: 'Flip stratégie',
  WINDOW_CLOSE: 'Fenêtre',
};
