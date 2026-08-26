import type { CryptoAlgoOptimizeReport } from './optimize-report.js';
import { OPTIMIZE_REPORT_MIN_CLOSED } from './optimize-report.js';

export interface OptimizeReportRecommendedChange {
  field: string;
  label: string;
  from: string;
  to: string;
  reason: string;
}

export interface OptimizeReportRecommendedConfig {
  applicable: boolean;
  changes: OptimizeReportRecommendedChange[];
  /** Partial PATCH body (camelCase) for PUT /api/config/crypto */
  patch: Record<string, unknown>;
}

const RECOMMENDED_SL_PERCENT = 32;
const RECOMMENDED_TRAILING_ACTIVATION = 12;
const RECOMMENDED_TRAILING_STOP = 10;
const RECOMMENDED_PRE_CLOSE_SECONDS = 45;
const RECOMMENDED_BASE_THRESHOLD = 0.62;

function formatConfigValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return String(value);
}

function proposeChange(
  changes: OptimizeReportRecommendedChange[],
  patch: Record<string, unknown>,
  field: string,
  label: string,
  current: unknown,
  next: unknown,
  reason: string,
): void {
  if (Object.is(current, next)) return;
  if (typeof current === 'number' && typeof next === 'number' && current === next) return;
  changes.push({
    field,
    label,
    from: formatConfigValue(current),
    to: formatConfigValue(next),
    reason,
  });
  patch[field] = next;
}

/**
 * Derives a conservative risk_config PATCH from report metrics.
 * Only tunables that map to crypto_algo exit/entry settings are included.
 */
export function buildRecommendedCryptoAlgoConfig(
  report: CryptoAlgoOptimizeReport,
): OptimizeReportRecommendedConfig {
  const changes: OptimizeReportRecommendedChange[] = [];
  const patch: Record<string, unknown> = {};
  const cfg = report.config;

  if (report.totals.closed < OPTIMIZE_REPORT_MIN_CLOSED) {
    return { applicable: false, changes, patch };
  }

  const slRow = report.byCloseReason.find((r) => r.closeReason === 'SL');
  const redRow = report.byCloseReason.find((r) => r.closeReason === 'REDEMPTION');
  const slPnl = slRow?.sumPnl ?? 0;
  const redPnl = redRow?.sumPnl ?? 0;
  const slDestroysEdge =
    slRow != null &&
    redRow != null &&
    slPnl < 0 &&
    redPnl > 0 &&
    Math.abs(slPnl) > redPnl * 0.5;

  if (slDestroysEdge && cfg.cryptoAlgoSlEnabled) {
    const current = cfg.cryptoAlgoSlPercent ?? 20;
    const target =
      current < 28 ? RECOMMENDED_SL_PERCENT : Math.min(current + 5, 38);
    proposeChange(
      changes,
      patch,
      'cryptoAlgoSlPercent',
      'SL (% de la mise)',
      cfg.cryptoAlgoSlPercent,
      target,
      'Réduire les sorties SL prématurées vs REDEMPTION gagnantes',
    );
  }

  const needsTrailing =
    (report.whipsaw.count >= 10 && report.whipsaw.sumPnl < 0) ||
    (report.trailingOpportunity.count >= 20 && report.trailingOpportunity.sumPnl < 0);

  if (needsTrailing) {
    if (!cfg.cryptoAlgoTrailingEnabled) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoTrailingEnabled',
        'Trailing stop',
        cfg.cryptoAlgoTrailingEnabled,
        true,
        'Verrouiller les run-ups avant un SL giveback',
      );
    }
    const activation = cfg.cryptoAlgoTrailingActivationPercent;
    if (activation == null || activation > RECOMMENDED_TRAILING_ACTIVATION) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoTrailingActivationPercent',
        'Activation trailing (% de la mise)',
        activation,
        RECOMMENDED_TRAILING_ACTIVATION,
        'Activer le trailing après ~12 % de gain',
      );
    }
    const stop = cfg.cryptoAlgoTrailingPercent;
    if (stop == null || stop > RECOMMENDED_TRAILING_STOP) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoTrailingPercent',
        'Trailing stop (% de la mise)',
        stop,
        RECOMMENDED_TRAILING_STOP,
        'Stop trailing à ~10 % de la mise du peak',
      );
    }
  }

  const redemptionLosses = report.byAsset.reduce((s, a) => s + a.redemptionLosses, 0);
  if (redemptionLosses >= 5) {
    if (!cfg.cryptoAlgoPreCloseEnabled) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoPreCloseEnabled',
        'Pre-close',
        cfg.cryptoAlgoPreCloseEnabled,
        true,
        'Couper les losers avant résolution',
      );
    }
    const preCloseSec = cfg.cryptoAlgoPreCloseSeconds ?? null;
    if (preCloseSec == null || preCloseSec > RECOMMENDED_PRE_CLOSE_SECONDS) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoPreCloseSeconds',
        'Pre-close (s)',
        cfg.cryptoAlgoPreCloseSeconds,
        RECOMMENDED_PRE_CLOSE_SECONDS,
        'Sortie ~45 s avant la fin si position perdante',
      );
    }
    proposeChange(
      changes,
      patch,
      'cryptoAlgoPreCloseKeepEnabled',
      'Pre-close keep enabled',
      cfg.cryptoAlgoPreCloseKeepEnabled,
      true,
      'Conserver les positions gagnantes jusqu’à la résolution',
    );
    proposeChange(
      changes,
      patch,
      'cryptoAlgoPreCloseKeepBidThreshold',
      'Pre-close keep bid threshold',
      cfg.cryptoAlgoPreCloseKeepBidThreshold,
      null,
      'Seuil de bid pour conserver une position gagnante',
    );
  }

  const midEntry = report.entryBuckets.filter((b) =>
    ['b_0.55-0.60', 'c_0.60-0.65'].includes(b.bucket),
  );
  const midPnl = midEntry.reduce((s, b) => s + b.sumPnl, 0);
  const midCount = midEntry.reduce((s, b) => s + b.count, 0);
  if (midCount >= 30 && midPnl < -50) {
    const currentThreshold = cfg.cryptoAlgoBaseThreshold;
    if (currentThreshold == null || currentThreshold < RECOMMENDED_BASE_THRESHOLD) {
      proposeChange(
        changes,
        patch,
        'cryptoAlgoBaseThreshold',
        'Seuil momentum (base)',
        currentThreshold,
        RECOMMENDED_BASE_THRESHOLD,
        'Renforcer le filtre d’entrée sur la zone 0.55–0.65',
      );
    }
  }

  // Sizing recommendations: suggest fixed_usdc with appropriate amount based on balance
  if (cfg.cryptoAlgoSizingMode !== 'fixed_usdc') {
    proposeChange(
      changes,
      patch,
      'cryptoAlgoSizingMode',
      'Mode de sizing algo',
      cfg.cryptoAlgoSizingMode,
      'fixed_usdc',
      'Le mode fixed_usdc est recommandé pour le sizing algo',
    );
  }
  if (cfg.cryptoAlgoEntryUsdcAmount < 5 || cfg.cryptoAlgoEntryUsdcAmount > 50) {
    const target = Math.min(Math.max(cfg.cryptoAlgoEntryUsdcAmount, 10), 25);
    proposeChange(
      changes,
      patch,
      'cryptoAlgoEntryUsdcAmount',
      'Montant USDC par entrée algo',
      cfg.cryptoAlgoEntryUsdcAmount,
      target,
      'Ajuster le montant USDC par entrée pour le sizing algo',
    );
  }

  return {
    applicable: changes.length > 0,
    changes,
    patch,
  };
}
