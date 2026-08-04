import { createMemo, createSignal, For, Show } from 'solid-js';
import type { useWeatherAlgoPositions, WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { formatShortDateTime } from '../lib/date';
import { CollapsibleSection } from './CollapsibleSection';
import {
  formatPnlAmount,
  formatPnlPercent,
  pnlClass as genericPnlClass,
  pnlPercent,
} from '../lib/position';
import {
  bucketLabel,
  formatPnL,
  formatWeatherDate,
  pnlClass,
  type WeatherBucketBounds,
} from '../lib/weather-position';

export interface WeatherAlgoPositionsPanelProps {
  positions: ReturnType<typeof useWeatherAlgoPositions>;
}

type PositionsState = ReturnType<typeof useWeatherAlgoPositions>;

const MODE_LABELS: Record<'all' | 'live' | 'sim', string> = {
  all: 'Tous',
  live: 'Live',
  sim: 'Sim',
};

function matchesMode(
  pos: WeatherPosition,
  mode: 'all' | 'live' | 'sim',
): boolean {
  return mode === 'all' || pos.mode === mode;
}

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
  const [activeTab, setActiveTab] = createSignal<'live' | 'sim'>('live');

  const openPositions = createMemo(() =>
    p().positions().filter((pos) => matchesMode(pos, p().posModeFilter())),
  );
  const livePositions = createMemo(() =>
    openPositions().filter((pos) => pos.mode === 'live'),
  );
  const simPositions = createMemo(() =>
    openPositions().filter((pos) => pos.mode === 'sim'),
  );

  const activePositions = createMemo(() =>
    activeTab() === 'live' ? livePositions() : simPositions(),
  );

  const closedList = createMemo(() =>
    p().closedPositions().filter((pos) => matchesMode(pos, p().posModeFilter())),
  );

  return (
    <CollapsibleSection
      title="Positions weather-algo"
      persistKey="polywatch_weather_positions_collapsed"
      class="algo-panel-full"
      headerActions={
        <div class="weather-position-header-right">
          <div class="weather-position-tabs">
            <button
              class={`weather-position-tab ${p().posTab() === 'open' ? 'weather-position-tab--active' : ''}`}
              onClick={() => p().selectPosTab('open')}
            >
              Ouvertes ({p().positions().length})
            </button>
            <button
              class={`weather-position-tab ${p().posTab() === 'history' ? 'weather-position-tab--active' : ''}`}
              onClick={() => p().selectPosTab('history')}
            >
              Historique ({p().closedPositions().length})
            </button>
          </div>
          <div class="weather-position-mode-tabs">
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'all' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('all')}
            >
              Tous
            </button>
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'live' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('live')}
            >
              Live
            </button>
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'sim' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('sim')}
            >
              Sim
            </button>
          </div>
        </div>
      }
    >

      <Show when={p().posTab() === 'open'}>
        <div class="weather-position-subtabs">
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

        <Show when={!p().loading()} fallback={<div class="algo-empty">Chargement…</div>}>
          <Show
            when={activePositions().length > 0}
            fallback={
              <div class="algo-empty">
                Aucune position {activeTab().toUpperCase()} ouverte
                {p().posModeFilter() !== 'all' ? ` en mode ${MODE_LABELS[p().posModeFilter()]}` : ''}.
              </div>
            }
          >
            <div class="weather-position-grid">
              <For each={activePositions()}>
                {(pos) => <WeatherPositionCard pos={pos} onClose={(id) => p().closePosition(id)} />}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      <Show when={p().posTab() === 'history'}>
        <Show when={!p().loadingHistory()} fallback={<div class="algo-empty">Chargement de l'historique…</div>}>
          <Show
            when={closedList().length > 0}
            fallback={
              <div class="algo-empty">
                Aucune position clôturée
                {p().posModeFilter() !== 'all' ? ` en mode ${MODE_LABELS[p().posModeFilter()]}` : ''}.
              </div>
            }
          >
            <div class="algo-table-wrap">
              <table class="algo-table">
                <thead>
                  <tr>
                    <th>Ville</th>
                    <th>Date cible</th>
                    <th>Bucket</th>
                    <th>Outcome</th>
                    <th>Qté</th>
                    <th>Prix entrée</th>
                    <th>PnL réalisé</th>
                    <th>Mode</th>
                    <th>Clôturé le</th>
                    <th>Marché</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={closedList()}>
                    {(pos) => {
                      const wf = pos.weatherForecast;
                      const invested =
                        pos.status === 'closed' &&
                        pos.entryInvestedAmount != null &&
                        pos.entryInvestedAmount > 0
                          ? pos.entryInvestedAmount
                          : pos.quantity * pos.entryPrice;
                      const pct = pnlPercent(pos.realizedPnl, invested);
                      const qty =
                        pos.status === 'closed' &&
                        pos.quantity <= 0 &&
                        pos.entryQuantityFilled != null &&
                        pos.entryQuantityFilled > 0
                          ? pos.entryQuantityFilled
                          : pos.quantity;
                      return (
                        <tr>
                          <td class="weather-history-city">{wf?.city ?? '—'}</td>
                          <td class="text-mono text-sm">
                            {wf ? formatWeatherDate(wf.targetDate) : '—'}
                          </td>
                          <td class="text-sm">
                            {bucketLabel(
                              wf?.entryBucketComparison ?? null,
                              (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
                            )}
                          </td>
                          <td>
                            <span class="algo-badge">{pos.outcome}</span>
                          </td>
                          <td class="text-mono">{qty.toFixed(4)}</td>
                          <td class="text-mono">{pos.entryPrice.toFixed(3)}</td>
                          <td class={`text-mono ${genericPnlClass(pos.realizedPnl)}`}>
                            {formatPnlAmount(pos.realizedPnl, true)}
                            <Show when={pct != null}>
                              <span class="algo-pnl-pct"> ({formatPnlPercent(pct)})</span>
                            </Show>
                          </td>
                          <td>
                            <span class={`algo-mode-badge ${pos.mode}`}>
                              {pos.mode === 'real' ? 'Réel' : pos.mode === 'sim' ? 'Sim' : pos.mode}
                            </span>
                          </td>
                          <td class="text-mono text-sm">
                            {pos.closedAt ? formatShortDateTime(pos.closedAt) : '—'}
                          </td>
                          <td>
                            <Show when={pos.marketUrl}>
                              <a
                                class="btn btn-sm btn-ghost weather-position-card__link"
                                href={pos.marketUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Voir
                              </a>
                            </Show>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Show>
    </CollapsibleSection>
  );
}