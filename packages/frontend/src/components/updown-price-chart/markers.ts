import type { UpDownPricePoint } from '../../lib/market-chart';
import { formatUpDownPriceCents } from '../../lib/updown-price-chart';
import { closeExecutionErrorLabel } from '../../lib/execution';
import type { SignalExecutionStatus } from '../../lib/updown-chart-overlays';

export function signalMarkerClass(status: SignalExecutionStatus): string {
  switch (status.kind) {
    case 'executed':
      return 'updown-chart-signal-marker-executed';
    case 'failed':
      return 'updown-chart-signal-marker-failed';
    case 'pending':
      return 'updown-chart-signal-marker-pending';
    case 'not_executed':
      return 'updown-chart-signal-marker-failed';
  }
}

export function formatSignalMarkerLabel(
  point: UpDownPricePoint,
  status: SignalExecutionStatus,
  maxSlippagePercent: number | null,
): string {
  const m = point.metrics;
  const outcome = m?.lastSignalOutcome ?? '?';
  const conf =
    m?.lastSignalConfidence != null
      ? ` (${(m.lastSignalConfidence * 100).toFixed(0)}%)`
      : '';
  const age =
    m?.signalAgeMs != null ? ` · âge ${Math.round(m.signalAgeMs)} ms` : '';
  const strategy = m?.lastSignalStrategyId
    ? ` · ${m.lastSignalStrategyId}`
    : '';
  const base = `Signal ${outcome}${conf}${age}${strategy}`;

  switch (status.kind) {
    case 'executed':
      return `${base} · ✅ Exécuté @ ${formatUpDownPriceCents(status.fillPrice)}`;
    case 'failed': {
      const reasonLabel = closeExecutionErrorLabel(status.error) ?? 'échec';
      const isSlippage = status.error === 'slippage_exceeded';
      if (isSlippage) {
        const maxStr =
          maxSlippagePercent != null
            ? `acceptable ≤ ${maxSlippagePercent}%`
            : 'acceptable (non configuré)';
        const detStr =
          status.slippagePercent != null
            ? ` · détecté ${status.slippagePercent.toFixed(2)}%`
            : ' · ordre rejeté avant exécution CLOB';
        return `${base} · ❌ ${reasonLabel} · ${maxStr}${detStr}`;
      }
      return `${base} · ❌ ${reasonLabel}`;
    }
    case 'pending':
      return `${base} · ⏳ En attente d'exécution`;
    case 'not_executed':
      return `${base} · ❌ Non exécuté`;
  }
}
