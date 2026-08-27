import { Show, createEffect, createMemo } from 'solid-js';
import type { CryptoAlgoHealthAlert } from '../lib/crypto-algo-health';
import type { AlgoMarketStatus } from '../stores/algoMarketsStore';
import { setCryptoAlgoAlerts } from '../stores/notificationStore';
import { CryptoAlgoOptimizeReportDialogTrigger } from './dialogs/CryptoAlgoOptimizeReportDialog';
import { CryptoAlgoSettingsDialogTrigger } from './dialogs/CryptoAlgoSettingsDialog';
import { Icon } from './Icon';

export interface CryptoAlgoHeaderProps {
  status: AlgoMarketStatus | null;
  cryptoAlgoEnabled: boolean | null;
  realTradingEnabled: boolean;
  healthAlerts: CryptoAlgoHealthAlert[];
  fullPage?: boolean;
  onToggleFullPage?: () => void;
  onAutoTrackChange: () => void;
  onOpenReports?: () => void;
}

/** Process liveness × kill-switch → badge label/class. */
export function resolveCryptoAlgoStatusBadge(
  alive: boolean,
  cryptoAlgoEnabled: boolean | null,
): { className: string; label: string; title: string } {
  if (!alive) {
    return {
      className: 'stopped',
      label: 'Arrêté',
      title: 'Le process crypto-algo ne répond plus (heartbeat > 60 s).',
    };
  }
  if (cryptoAlgoEnabled === false) {
    return {
      className: 'trading-off',
      label: 'En ligne · trading OFF',
      title:
        'Le process tourne, mais crypto-algo est désactivé dans la config — aucune nouvelle entrée.',
    };
  }
  return {
    className: 'alive',
    label: 'En ligne',
    title: 'Process crypto-algo actif et trading autorisé par la config.',
  };
}

export function CryptoAlgoHeader(props: CryptoAlgoHeaderProps) {
  createEffect(() => {
    setCryptoAlgoAlerts(props.healthAlerts);
  });

  const statusBadge = createMemo(() => {
    const s = props.status;
    if (!s) return null;
    return resolveCryptoAlgoStatusBadge(s.alive, props.cryptoAlgoEnabled);
  });

  return (
    <header class="crypto-algo-header-v2">
      <div class="crypto-algo-title-row">
        <h1 class="page-title-v2">Crypto Algo</h1>
        <Show when={statusBadge()}>
          {(b) => (
            <span
              class={`algo-status-badge ${b().className}`}
              title={b().title}
            >
              <span class="algo-status-dot" />
              {b().label}
            </span>
          )}
        </Show>
        <Show when={props.cryptoAlgoEnabled === true && !props.realTradingEnabled}>
          <span class="algo-status-badge sim-only">Sim uniquement</span>
        </Show>
      </div>
      <div class="crypto-algo-header-actions">
        <Show when={props.onToggleFullPage}>
          <button
            type="button"
            class={`btn btn-ghost btn-sm crypto-algo-fullpage-btn${props.fullPage ? ' active' : ''}`}
            onClick={() => props.onToggleFullPage?.()}
            title={props.fullPage ? 'Quitter le plein écran (Échap)' : 'Plein écran'}
            aria-pressed={props.fullPage ? 'true' : 'false'}
          >
            <Icon name={props.fullPage ? 'minimize' : 'maximize'} size={16} />
            <span>{props.fullPage ? 'Réduire' : 'Plein écran'}</span>
          </button>
        </Show>
        <CryptoAlgoOptimizeReportDialogTrigger onOpenReportsPage={props.onOpenReports} />
        <CryptoAlgoSettingsDialogTrigger onAutoTrackChange={props.onAutoTrackChange} />
      </div>
    </header>
  );
}
