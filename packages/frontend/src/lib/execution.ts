import { formatAdaptiveAmount, formatPnlAmount, pnlClass } from './position';

export interface Execution {
  id: number;
  orderSignalId: string;
  copiedPositionId?: number;
  side: string;
  reason: string;
  status: string;
  fillPrice: number | null;
  fillQuantity: number | null;
  referenceVwap?: number | null;
  slippagePercent?: number | null;
  fees?: number;
  realizedPnl?: number;
  mode: string;
  error?: string | null;
  executedAt: string | null;
  marketQuestion?: string | null;
  outcome?: string | null;
  conditionId?: string | null;
  /** Owning weather strategy (resolved from the linked position). */
  strategyId?: string | null;
}

/**
 * Detected slippage percent between fillPrice and referenceVwap.
 * Returns null when either value is missing, or when the execution is not
 * filled/partial (e.g. failed executions carry fillPrice=0 which would
 * produce an absurd 100% slippage — prefer the persisted slippagePercent
 * column for those cases, exposed as `ex.slippagePercent`).
 */
export function computeExecutionSlippagePercent(ex: Execution): number | null {
  if (ex.status !== 'filled' && ex.status !== 'partial') return null;
  if (ex.fillPrice == null || ex.referenceVwap == null || ex.referenceVwap <= 0) return null;
  return (Math.abs(ex.fillPrice - ex.referenceVwap) / ex.referenceVwap) * 100;
}

const EXECUTION_REASON_LABELS: Record<string, string> = {
  ALGO_OPEN: 'Ouverture',
  ALGO_INCREASE: 'Renforcement',
  SL: 'Stop-loss',
  TP: 'Take-profit',
  TRAILING: 'Trailing stop',
  PRE_CLOSE_LOSS: 'Pré-clôture (perte)',
  PRE_CLOSE_WIN: 'Pré-clôture (gain)',
  WEATHER_FORECAST_CHANGE: 'Changement forecast',
  WEATHER_BUCKET_EXIT: 'Sortie palier',
  REDEMPTION: 'Redemption',
  KILL_SWITCH: 'Kill switch',
  MANUAL: 'Manuel',
  COPY_OPEN: 'Copy ouverture',
  COPY_INCREASE: 'Copy renforcement',
  COPY_DECREASE: 'Copy réduction',
  COPY_CLOSE: 'Copy clôture',
};

export function executionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return EXECUTION_REASON_LABELS[reason] ?? reason;
}

const CLOSE_EXECUTION_ERROR_LABELS: Record<string, string> = {
  order_not_matched: 'ordre FAK non matché (pas de contrepartie au prix)',
  no_liquidity: 'liquidité insuffisante',
  placing_orphan: 'exécution interrompue (worker)',
  slippage_exceeded: 'glissement trop élevé',
  insufficient_balance: 'solde tokens insuffisant sur le wallet de dépôt',
  insufficient_allowance: 'allowance CLOB insuffisante',
  real_trading_disabled: 'trading live désactivé',
  sim_copy_trading_disabled: 'copy trading sim désactivé',
  real_copy_trading_disabled: 'copy trading réel désactivé',
  reservation_expired: 'réservation expirée (ordre non traité à temps)',
  signal_id_collision: 'signal déjà traité (collision idempotence)',
  below_min_order_size: 'quantité trop faible pour le CLOB',
  tick_size_fetch_failed: 'impossible de lire le tick size CLOB',
  price_rounded_to_zero: 'prix arrondi à zéro',
  clob_rejected: 'ordre CLOB rejeté par l’exchange',
  clob_order_failed: 'ordre CLOB rejeté',
  clob_approvals_failed: 'approbations CLOB manquantes',
  clob_credentials_not_found: 'identifiants CLOB absents',
  clob_credentials_incomplete: 'identifiants CLOB incomplets',
  no_deposit_address: 'adresse de dépôt absente',
  fill_parse_invalid_price: 'réponse CLOB illisible (prix)',
  fill_parse_invalid_quantity: 'réponse CLOB illisible (quantité)',
  redemption_failed: 'redemption on-chain échouée',
};

export function closeExecutionErrorLabel(
  error: string | null | undefined,
): string | null {
  if (!error) return null;
  // Some errors carry a machine code prefix followed by a detail string,
  // e.g. "redemption_failed: signerPkEnc missing". Surface the human label
  // for the code and append the backend detail when available.
  const [code, ...detailParts] = error.split(':');
  const detail = detailParts.join(':').trim();
  const label = CLOSE_EXECUTION_ERROR_LABELS[code.trim()] ?? error;
  if (
    (code.trim() === 'redemption_failed' || code.trim() === 'clob_rejected') &&
    detail
  ) {
    return `${label} (${detail})`;
  }
  return label;
}

export function closeExecutionErrorHint(
  error: string | null | undefined,
): string | null {
  const label = closeExecutionErrorLabel(error);
  if (!label) return null;
  return `Clôture impossible : ${label}`;
}

export function executionStatusClass(status: string): string {
  if (status === 'filled') return 'status-filled';
  if (status === 'failed') return 'status-failed';
  if (status === 'no_payout') return 'status-neutral';
  return 'status-pending';
}

export function executionStatusLabel(status: string): string {
  if (status === 'filled') return 'Remplie';
  if (status === 'failed') return 'Échouée';
  if (status === 'no_payout') return 'Sans gain';
  if (status === 'placed' || status === 'placing') return 'Placement…';
  if (status === 'live_on_clob') return 'Sur CLOB';
  if (status === 'partial') return 'Partielle';
  return status;
}

export function executionBuyStake(ex: Execution): number | null {
  if (ex.fillPrice == null || ex.fillQuantity == null) return null;
  const stake = ex.fillPrice * ex.fillQuantity + (ex.fees ?? 0);
  return Number.isFinite(stake) ? stake : null;
}

const EXECUTION_PNL_STATUSES = new Set(['filled', 'partial', 'no_payout']);

export function formatExecutionCashImpact(
  ex: Execution,
): { text: string; className: string } | null {
  if (ex.side === 'BUY') {
    const stake = executionBuyStake(ex);
    if (stake == null) return null;
    return { text: formatAdaptiveAmount(stake), className: 'text-mono' };
  }

  if (ex.side === 'SELL' && EXECUTION_PNL_STATUSES.has(ex.status)) {
    const pnl = ex.realizedPnl ?? 0;
    return {
      text: formatPnlAmount(pnl, true),
      className: `text-mono ${pnlClass(pnl)}`,
    };
  }

  return null;
}