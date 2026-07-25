import { Show } from 'solid-js';
import { formatAlgoCapital, type AlgoCapital } from '../lib/algo-capital';
import { formatPnlAmount, pnlClass } from '../lib/position';
import type { useClobCredentials } from '../hooks/useClobCredentials';

type ClobCredentialsState = ReturnType<typeof useClobCredentials>;

export interface CryptoAlgoCapitalDashboardProps {
  capital: AlgoCapital | null;
  realTradingEnabled: boolean;
  creds: ClobCredentialsState;
  onToggleRealTrading: () => void;
}

export function CryptoAlgoCapitalDashboard(props: CryptoAlgoCapitalDashboardProps) {
  return (
    <section class="algo-capital-dashboard">
      <Show
        when={props.capital}
        fallback={<div class="algo-capital-loading">Chargement du capital…</div>}
      >
        {(cap) => (
          <>
            <div class="algo-capital-card sim">
              <div class="algo-capital-header">
                <div class="algo-capital-label">Capital Simulation</div>
                <div class="algo-capital-value">{formatAlgoCapital(cap().sim.equity)}</div>
              </div>
              <div class="algo-capital-details">
                <div class="algo-capital-detail">
                  <span class="detail-label">Cash</span>
                  <span class="detail-value">{formatAlgoCapital(cap().sim.cash)}</span>
                </div>
                <div class="algo-capital-detail">
                  <span class="detail-label">Positions</span>
                  <span class="detail-value">{formatAlgoCapital(cap().sim.positionsValue)}</span>
                </div>
                <div class="algo-capital-detail">
                  <span class="detail-label">PnL ouvert</span>
                  <span class={`detail-value ${pnlClass(cap().sim.openPnl)}`}>
                    {formatPnlAmount(cap().sim.openPnl, true)}
                  </span>
                </div>
                <div class="algo-capital-detail">
                  <span class="detail-label">PnL fermé</span>
                  <span class={`detail-value ${pnlClass(cap().sim.closedPnl)}`}>
                    {formatPnlAmount(cap().sim.closedPnl, true)}
                  </span>
                </div>
                <div class="algo-capital-detail">
                  <span class="detail-label">Capital initial</span>
                  <span class="detail-value">{formatAlgoCapital(cap().sim.baselineCapital)}</span>
                </div>
              </div>
            </div>
            <div class="algo-capital-card real">
              <div class="algo-capital-card-top">
                <div class="algo-capital-header">
                  <div class="algo-capital-label">Capital Réel</div>
                  <Show
                    when={cap().real.availableCash != null}
                    fallback={<div class="algo-capital-value muted">Non disponible</div>}
                  >
                    <div class="algo-capital-value">
                      {formatAlgoCapital(cap().real.availableCash!)}
                    </div>
                  </Show>
                </div>
                <div class="algo-capital-toggle">
                  <span class="algo-capital-toggle-label">Trading réel algo</span>
                  <div class="algo-capital-toggle-row">
                    <label class="toggle-switch danger">
                      <input
                        type="checkbox"
                        checked={props.realTradingEnabled}
                        disabled={!props.creds.liveReady()}
                        onChange={() => props.onToggleRealTrading()}
                      />
                      <span class="toggle-track" />
                    </label>
                    <span class={`badge ${props.realTradingEnabled ? 'real' : 'neutral'}`}>
                      {props.realTradingEnabled ? 'Activé' : 'Désactivé'}
                    </span>
                  </div>
                </div>
              </div>
              <Show when={cap().real.note}>
                <div class="algo-capital-note">{cap().real.note}</div>
              </Show>
              <Show when={props.creds.needsSetup()}>
                <div class="algo-capital-hint">
                  Credentials CLOB requis (onglet Portefeuille).
                </div>
              </Show>
              <Show when={props.creds.needsLiveSetup()}>
                <div class="algo-capital-hint">
                  {props.creds.blockMessage() ??
                    'Configuration live incomplète — vérifiez Portefeuille → Gérer les wallets.'}
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}
