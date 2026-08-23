import { Show } from 'solid-js';
import type { Signal } from 'solid-js';
import type { BacktestMarketSeriesDto } from '../../api';
import { BacktestMarketRidgeChart } from './BacktestMarketRidgeChart';

interface BacktestLiveRidgePanelProps {
  series: BacktestMarketSeriesDto[];
  total: number;
  window: { from: string | null; to: string | null };
  loading: boolean;
  error: string | null;
  /** Signal contrôlé du seuil de prix YES moyen (0..100) — partagé avec le fetch. */
  minAvgYes: Signal<number>;
}

function isValidIso(value: string | null): value is string {
  if (!value) return false;
  const t = Date.parse(value);
  return !Number.isNaN(t);
}

export function BacktestLiveRidgePanel(props: BacktestLiveRidgePanelProps) {
  const hasValidWindow = () => isValidIso(props.window.from) && isValidIso(props.window.to);

  return (
    <div class="backtest-live-ridge">
      <div class="backtest-live-ridge-header">
        <div class="backtest-live-ridge-title">
          <span class="backtest-live-ridge-badge">
            <span class="backtest-live-ridge-dot" />
            Live
          </span>
          <h3 class="settings-subheading">Marchés en direct</h3>
          <span class="algo-panel-count">{props.total} marché(s)</span>
        </div>
      </div>

      <Show when={props.error}>
        <p class="form-hint weather-settings-error">{props.error}</p>
      </Show>

      <Show
        when={hasValidWindow() && props.series.length > 0}
        fallback={
          <p class="form-hint">
            {props.loading ? 'Chargement des marchés…' : 'Aucune donnée marché sur cette fenêtre.'}
          </p>
        }
      >
        <BacktestMarketRidgeChart
          series={props.series}
          positions={[]}
          from={props.window.from!}
          to={props.window.to!}
          enablePlayer={false}
          minAvgYes={props.minAvgYes}
        />
      </Show>
    </div>
  );
}