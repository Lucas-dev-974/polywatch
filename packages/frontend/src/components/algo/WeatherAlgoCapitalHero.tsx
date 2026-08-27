import { Show } from 'solid-js';
import { formatWeatherAlgoCapital, type WeatherAlgoCapital } from '../../lib/weather-algo-capital';
import { formatPnlAmount, pnlClass } from '../../lib/position';
import { CollapsibleSection } from '../CollapsibleSection';

export interface WeatherAlgoCapitalHeroProps {
  capital: WeatherAlgoCapital | null;
  realTradingEnabled: boolean;
  weatherAlgoSimEnabled: boolean;
  weatherAlgoRealEnabled: boolean;
  onToggleRealTrading: () => void;
  onResetSim?: () => void;
}

export function WeatherAlgoCapitalHero(props: WeatherAlgoCapitalHeroProps) {
  return (
    <CollapsibleSection
      class="weather-algo-capital-hero"
      title="Capital"
      persistKey="weatherAlgoCapitalHeroCollapsed"
      defaultCollapsed
      headerActions={
        <Show when={props.capital}>
          {(cap) => (
            <span class="weather-algo-capital-header-values">
              <span class="algo-capital-header-value sim">
                <span class="detail-label">Sim</span>
                <Show when={cap().sim != null} fallback={<span class="muted">—</span>}>
                  <span class="detail-value">
                    {formatWeatherAlgoCapital(cap().sim!.equity)}
                  </span>
                </Show>
              </span>
              <span class="algo-capital-header-value real">
                <span class="detail-label">Réel</span>
                <Show
                  when={cap().real.availableCash != null}
                  fallback={<span class="muted">—</span>}
                >
                  <span class="detail-value">
                    {formatWeatherAlgoCapital(cap().real.availableCash!)}
                  </span>
                </Show>
              </span>
            </span>
          )}
        </Show>
      }
    >
      <div class="algo-capital-dashboard">
        <Show
          when={props.capital}
          fallback={<div class="algo-capital-loading">Chargement du capital…</div>}
        >
          {(cap) => (
            <>
              <div class="algo-capital-card sim">
                <div class="algo-capital-header">
                  <div class="algo-capital-label">Capital Simulation (périmètre weather)</div>
                  <Show
                    when={cap().sim != null}
                    fallback={<div class="algo-capital-value muted">Indisponible</div>}
                  >
                    <div class="algo-capital-value">{formatWeatherAlgoCapital(cap().sim!.equity)}</div>
                  </Show>
                </div>
                <Show when={cap().sim != null}>
                  <div class="algo-capital-details">
                    <div class="algo-capital-detail">
                      <span class="detail-label">Cash</span>
                      <span class="detail-value">{formatWeatherAlgoCapital(cap().sim!.cash)}</span>
                    </div>
                    <div class="algo-capital-detail">
                      <span class="detail-label">Exposition</span>
                      <span class="detail-value">{formatWeatherAlgoCapital(cap().sim!.positionsValue)}</span>
                    </div>
                    <div class="algo-capital-detail">
                      <span class="detail-label">Capital de base</span>
                      <span class="detail-value">{formatWeatherAlgoCapital(cap().sim!.baselineCapital)}</span>
                    </div>
                    <div class="algo-capital-detail">
                      <span class="detail-label">PnL ouvert</span>
                      <span class={`detail-value ${pnlClass(cap().sim!.openPnl)}`}>
                        {formatPnlAmount(cap().sim!.openPnl, true)}
                      </span>
                    </div>
                    <div class="algo-capital-detail">
                      <span class="detail-label">PnL fermé</span>
                      <span class={`detail-value ${pnlClass(cap().sim!.closedPnl)}`}>
                        {formatPnlAmount(cap().sim!.closedPnl, true)}
                      </span>
                    </div>
                    <div class="algo-capital-detail">
                      <span class="detail-label">Mode sim</span>
                      <span class={`detail-value ${props.weatherAlgoSimEnabled ? 'real' : 'neutral'}`}>
                        {props.weatherAlgoSimEnabled ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                  </div>
                  <div class="algo-capital-actions">
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      onClick={() => props.onResetSim?.()}
                    >
                      Réinitialiser la simulation
                    </button>
                  </div>
                </Show>
              </div>

              <div class="algo-capital-card real">
                <div class="algo-capital-card-top">
                  <div class="algo-capital-header">
                    <div class="algo-capital-label">Capital Réel (global, partagé)</div>
                    <Show
                      when={cap().real.availableCash != null}
                      fallback={<div class="algo-capital-value muted">Non disponible</div>}
                    >
                      <div class="algo-capital-value">
                        {formatWeatherAlgoCapital(cap().real.availableCash!)}
                      </div>
                    </Show>
                  </div>
                  <div class="algo-capital-toggle">
                    <span class="algo-capital-toggle-label">Master kill global (realTradingEnabled)</span>
                    <div class="algo-capital-toggle-row">
                      <label class="toggle-switch danger">
                        <input
                          type="checkbox"
                          checked={props.realTradingEnabled}
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
                <div class="algo-capital-detail">
                  <span class="detail-label">Mode réel weather</span>
                  <span class={`detail-value ${props.weatherAlgoRealEnabled ? 'real' : 'neutral'}`}>
                    {props.weatherAlgoRealEnabled ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                <Show when={cap().real.note}>
                  <div class="algo-capital-note">{cap().real.note}</div>
                </Show>
                <Show when={props.realTradingEnabled && !props.weatherAlgoRealEnabled}>
                  <div class="algo-capital-hint">
                    Le master kill global est actif mais le mode réel weather est désactivé
                    (onglet Paramètres).
                  </div>
                </Show>
                <Show when={!props.realTradingEnabled && props.weatherAlgoRealEnabled}>
                  <div class="algo-capital-hint">
                    Le mode réel weather est activé mais le master kill global est off —
                    aucun ordre réel ne sera passé.
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </CollapsibleSection>
  );
}
