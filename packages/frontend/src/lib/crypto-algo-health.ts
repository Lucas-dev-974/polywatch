export type CryptoAlgoHealthSeverity = 'info' | 'warning' | 'error';

export interface CryptoAlgoHealthAlert {
  severity: CryptoAlgoHealthSeverity;
  title: string;
  message: string;
}

export interface ExitEmitBlockAlertInput {
  id: number;
  status: string;
  lastExitBlockReason?: string | null;
  lastExitBlockCloseReason?: string | null;
  firstExitBlockAt?: string | Date | null;
  exitEmitBlockedCount?: number | null;
}

export interface CryptoAlgoHealthInput {
  processAlive: boolean | null;
  cryptoAlgoEnabled: boolean | null;
  realTradingEnabled: boolean;
  enabledLiveMarketCount: number;
  enabledSelectionCount: number;
  selectionsWithMarket: number | null;
  evaluableSelections: number | null;
  autoTrackEnabledRuleCount: number;
  nearestFutureStartMs: number | null;
  nearestFutureLabel: string | null;
  lastSkipReason: string | null;
  /** Open-like algo positions with pre-emit block fields. */
  exitEmitBlockedPositions?: ExitEmitBlockAlertInput[];
  nowMs?: number;
}

const OPEN_LIKE = new Set(['open', 'closing', 'failed', 'pending_resolution']);
const CRITICAL_BLOCK = new Set([
  'no_close_bid',
  'below_min_order_size',
  'forced_exit_retries_exhausted',
]);
const CRITICAL_CLOSE = new Set(['SL', 'TRAILING', 'KILL_SWITCH']);
const ALERT_MIN_AGE_MS = 30_000;
const ERROR_MIN_AGE_MS = 60_000;

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) {
    return `${min} min ${sec.toString().padStart(2, '0')} s`;
  }
  return `${sec} s`;
}

function isCriticalBlock(
  blockReason: string | null | undefined,
  closeReason: string | null | undefined,
): boolean {
  if (!blockReason || !CRITICAL_BLOCK.has(blockReason)) return false;
  if (blockReason === 'forced_exit_retries_exhausted') return true;
  return closeReason != null && CRITICAL_CLOSE.has(closeReason);
}

function blockedPositionsForAlert(
  positions: ExitEmitBlockAlertInput[] | undefined,
  nowMs: number,
): Array<ExitEmitBlockAlertInput & { ageMs: number }> {
  if (!positions?.length) return [];
  const out: Array<ExitEmitBlockAlertInput & { ageMs: number }> = [];
  for (const p of positions) {
    if (!OPEN_LIKE.has(p.status)) continue;
    if (!isCriticalBlock(p.lastExitBlockReason, p.lastExitBlockCloseReason)) {
      continue;
    }
    if (!p.firstExitBlockAt) continue;
    const firstMs = new Date(p.firstExitBlockAt).getTime();
    if (!Number.isFinite(firstMs)) continue;
    const ageMs = nowMs - firstMs;
    if (ageMs < ALERT_MIN_AGE_MS) continue;
    out.push({ ...p, ageMs });
  }
  return out;
}

/** Derive user-facing health alerts for the Crypto Algo dashboard. */
export function deriveCryptoAlgoHealthAlerts(
  input: CryptoAlgoHealthInput,
): CryptoAlgoHealthAlert[] {
  const alerts: CryptoAlgoHealthAlert[] = [];

  if (input.processAlive === false) {
    alerts.push({
      severity: 'error',
      title: 'Processus arrêté',
      message:
        'Le worker crypto-algo ne répond pas. Relancez npm run dev et vérifiez que le service crypto-algo tourne (badge En ligne).',
    });
  }

  if (input.cryptoAlgoEnabled === false) {
    alerts.push({
      severity: 'warning',
      title: 'Algo désactivé',
      message:
        'Crypto-algo est coupé dans les paramètres. Ouvrez Configurer et activez « Crypto-algo ».',
    });
  }

  if (
    input.enabledSelectionCount > 0 &&
    input.selectionsWithMarket != null &&
    input.selectionsWithMarket < input.enabledSelectionCount
  ) {
    const missing = input.enabledSelectionCount - input.selectionsWithMarket;
    alerts.push({
      severity: 'warning',
      title: 'Marchés non synchronisés',
      message: `${missing} sélection(s) sans metadata marché — le worker tente une resync automatique.`,
    });
  }

  if (
    input.cryptoAlgoEnabled === true &&
    input.processAlive !== false &&
    input.evaluableSelections === 0 &&
    input.enabledSelectionCount > 0 &&
    input.selectionsWithMarket === input.enabledSelectionCount
  ) {
    alerts.push({
      severity: 'info',
      title: 'Marchés non évaluables',
      message:
        'Les sélections actives ne sont pas tradables (expirées, fermées ou hors fenêtre).',
    });
  }

  const hasAutoTrack = input.autoTrackEnabledRuleCount > 0;
  const noLiveMarkets = input.enabledLiveMarketCount === 0;

  if (hasAutoTrack && noLiveMarkets) {
    if (input.nearestFutureStartMs != null && input.nearestFutureStartMs > 0) {
      const label = input.nearestFutureLabel ? ` (${input.nearestFutureLabel})` : '';
      alerts.push({
        severity: 'info',
        title: 'Hors fenêtre de trading',
        message: `Aucun marché en cours pour l'auto-track. Prochaine fenêtre${label} dans ${formatCountdown(input.nearestFutureStartMs)}.`,
      });
    } else {
      alerts.push({
        severity: 'warning',
        title: 'Aucun marché détecté',
        message:
          "L'auto-track est actif mais aucun marché live ou à venir n'a été trouvé. Vérifiez les règles et la connexion à Polymarket.",
      });
    }
  }

  if (
    !hasAutoTrack &&
    input.enabledSelectionCount === 0 &&
    noLiveMarkets
  ) {
    alerts.push({
      severity: 'warning',
      title: 'Rien à trader',
      message:
        "Ajoutez une règle auto-track dans Configurer ou activez un marché depuis l'onglet Marchés.",
    });
  }

  if (
    input.cryptoAlgoEnabled !== false &&
    input.processAlive !== false &&
    noLiveMarkets &&
    input.enabledSelectionCount > 0 &&
    !hasAutoTrack
  ) {
    alerts.push({
      severity: 'warning',
      title: 'Sélections inactives',
      message:
        'Des marchés sont suivis mais aucun n\'est dans une fenêtre live. Attendez la prochaine fenêtre ou activez l\'auto-track.',
    });
  }

  if (input.cryptoAlgoEnabled === true && input.processAlive !== false && !input.realTradingEnabled) {
    alerts.push({
      severity: 'info',
      title: 'Simulation uniquement',
      message:
        'Le trading réel algo est désactivé. Les ordres et positions apparaissent en mode Sim.',
    });
  }

  if (
    input.cryptoAlgoEnabled === true &&
    input.processAlive !== false &&
    input.lastSkipReason &&
    input.evaluableSelections != null &&
    input.evaluableSelections > 0
  ) {
    alerts.push({
      severity: 'info',
      title: 'Dernière évaluation',
      message: input.lastSkipReason,
    });
  }

  const nowMs = input.nowMs ?? Date.now();
  const blocked = blockedPositionsForAlert(input.exitEmitBlockedPositions, nowMs);
  if (blocked.length > 0) {
    const worst = blocked.reduce((a, b) => (a.ageMs >= b.ageMs ? a : b));
    const severity: CryptoAlgoHealthSeverity =
      worst.ageMs >= ERROR_MIN_AGE_MS &&
      worst.lastExitBlockCloseReason != null &&
      CRITICAL_CLOSE.has(worst.lastExitBlockCloseReason)
        ? 'error'
        : 'warning';
    const details = blocked
      .slice(0, 3)
      .map(
        (p) =>
          `#${p.id} ${p.lastExitBlockCloseReason}/${p.lastExitBlockReason} (${formatCountdown(p.ageMs)})`,
      )
      .join(' · ');
    alerts.push({
      severity,
      title: 'Sortie forcée bloquée',
      message:
        blocked.length === 1
          ? `Position ${details} — signal détecté mais non émis.`
          : `${blocked.length} positions bloquées à l'émission : ${details}.`,
    });
  }

  return alerts;
}

export function alertCssClass(severity: CryptoAlgoHealthSeverity): string {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

export function alertIcon(severity: CryptoAlgoHealthSeverity): string {
  if (severity === 'error') return '!';
  if (severity === 'warning') return '⚠';
  return 'i';
}
