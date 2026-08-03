import { createMemo, createSignal, For, Show } from 'solid-js';
import type { useWeatherAlgoPositions, WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import {
  bucketLabel,
  formatPnL,
  formatWeatherDate,
  pnlClass,
  type WeatherBucketBounds,
} from '../lib/weather-position';

type PositionsState = ReturnType<typeof useWeatherAlgoPositions>;

export interface WeatherAlgoPositionsPanelProps {
  positions: PositionsState;
}

type TabMode = 'live' | 'sim';

function WeatherPositionCard(props: { pos: WeatherPosition; onClose: (id: number) => void }) {
  const pos = props.pos;
  const wf = pos.weatherForecast;
  return (
    <div class="weather-position-card">
      <div class="weather-position-card__header">
        <div class="weather-position-card__identity">
          <span class="weather-position-card__city">{wf?.city ?? '—'}</span>
          <Show when={wf}>
            <span class="weather-position-card__date">{formatWeatherDate(wf!.targetDate)}</span>
          </Show>
        </div>
        <div class="weather-position-card__badges">
          <span class={`badge badge-mode badge-mode--${pos.mode}`}>
            {pos.mode.toUpperCase()}
          </span>
          <span class={`weather-pnl-badge ${pnlClass(pos.unrealizedPnl)}`}>
            {formatPnL(pos.unrealizedPnl)}
          </span>
        </div>
      </div>

      <div class="weather-position-card__body">
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Bucket entrée</span>
          <span class="weather-position-card__value">
            {bucketLabel(
              wf?.entryBucketComparison ?? null,
              (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
            )}
          </span>
        </div>
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Prévision à l'entrée</span>
          <span class="weather-position-card__value">
            {wf
              ? `${wf.entryForecastMean.toFixed(1)}°C (σ ${wf.entryForecastStdDev.toFixed(1)})`
              : '—'}
          </span>
        </div>
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Quantité</span>
          <span class="weather-position-card__value">{pos.quantity.toFixed(4)}</span>
        </div>
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Prix d'entrée</span>
          <span class="weather-position-card__value">{pos.entryPrice.toFixed(3)} USDC</span>
        </div>
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Montant investi</span>
          <span class="weather-position-card__value">
            {(pos.quantity * pos.entryPrice).toFixed(2)} USDC
          </span>
        </div>
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Outcome</span>
          <span class="weather-position-card__value">{pos.outcome}</span>
        </div>
      </div>

      <div class="weather-position-card__footer">
        <Show when={pos.marketUrl}>
          <a
            class="btn btn-sm btn-ghost weather-position-card__link"
            href={pos.marketUrl!}
            target="_blank"
            rel="noopener noreferrer"
          >
            Voir le marché
          </a>
        </Show>
        <button
          class="btn btn-sm btn-ghost weather-position-card__close"
          onClick={() => props.onClose(pos.id)}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

export function WeatherAlgoPositionsPanel(props: WeatherAlgoPositionsPanelProps) {
  const p = () => props.positions;
  const [activeTab, setActiveTab] = createSignal<TabMode>('live');

  const livePositions = createMemo(() => p().positions().filter((pos) => pos.mode === 'live'));
  const simPositions = createMemo(() => p().positions().filter((pos) => pos.mode === 'sim'));

  const activePositions = createMemo(() =>
    activeTab() === 'live' ? livePositions() : simPositions(),
  );

  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Positions weather-algo</h2>
        <div class="weather-position-tabs">
          <button
            class={`weather-position-tab ${activeTab() === 'live' ? 'weather-position-tab--active' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            Live ({livePositions().length})
          </button>
          <button
            class={`weather-position-tab ${activeTab() === 'sim' ? 'weather-position-tab--active' : ''}`}
            onClick={() => setActiveTab('sim')}
          >
            Sim ({simPositions().length})
          </button>
        </div>
      </div>

      <Show when={!p().loading()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show
          when={activePositions().length > 0}
          fallback={
            <div class="algo-empty">Aucune position {activeTab().toUpperCase()} ouverte.</div>
          }
        >
          <div class="weather-position-grid">
            <For each={activePositions()}>
              {(pos) => <WeatherPositionCard pos={pos} onClose={(id) => p().closePosition(id)} />}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}
