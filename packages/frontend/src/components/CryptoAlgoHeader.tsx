import { Show, createEffect } from 'solid-js';
import type { CryptoAlgoHealthAlert } from '../lib/crypto-algo-health';
import type { AlgoMarketStatus } from '../stores/algoMarketsStore';
import { setCryptoAlgoAlerts } from '../stores/notificationStore';
import { CryptoAlgoOptimizeReportDialogTrigger } from './CryptoAlgoOptimizeReportDialog';
import { CryptoAlgoSettingsDialogTrigger } from './CryptoAlgoSettingsDialog';
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

export function CryptoAlgoHeader(props: CryptoAlgoHeaderProps) {
  createEffect(() => {
    setCryptoAlgoAlerts(props.healthAlerts);
  });

  return (
    <header class="crypto-algo-header-v2">
      <div class="crypto-algo-title-row">
        <h1 class="page-title-v2">Crypto Algo</h1>
        <Show when={props.status}>
          {(s) => (
            <span class={`algo-status-badge ${s().alive ? 'alive' : 'stopped'}`}>
              <span class="algo-status-dot" />
              {s().alive ? 'En ligne' : 'Arrêté'}
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
