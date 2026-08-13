import { createMemo, createSignal, For, Show } from 'solid-js';
import type { useWeatherAlgoPositions, WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { formatShortDateTime } from '../lib/date';
import {
  UI_KEYS,
  WEATHER_ALGO_POS_OPEN_SUB_TABS,
  usePersistedEnum,
} from '../lib/ui-persistence';
import { CollapsibleSection } from './CollapsibleSection';
import { Icon } from './Icon';
import { AlgoCarousel } from './AlgoCarousel';
import { AlgoCarouselNav } from './AlgoCarouselNav';
import { useAlgoCarouselScroll } from '../hooks/useAlgoCarouselScroll';
import {
  formatPnlAmount,
  formatPnlPercent,
  pnlClass as genericPnlClass,
  pnlPercent,
} from '../lib/position';
import {
  formatBucketLabel,
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
  const invested = () => pos.quantity * pos.entryPrice;
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
            <span class="weather-pnl-badge__amount">{formatPnL(pos.unrealizedPnl)}</span>
            <span class="weather-pnl-badge__pct">
              {formatPnlPercent(pnlPercent(pos.unrealizedPnl, invested()))}
            </span>
          </span>
        </div>
      </div>

      <div class="weather-position-card__body">
        <div class="weather-position-card__metric">
          <span class="weather-position-card__label">Bucket entrée</span>
          <span class="weather-position-card__value">
            {formatBucketLabel(
              wf?.entryBucketComparison ?? null,
              (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
              wf?.unit ?? null,
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
            {invested().toFixed(2)} USDC
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

interface WeatherHistoryDateGroup {
  targetDate: string;
  positions: WeatherPosition[];
}

interface WeatherHistoryCityGroup {
  city: string;
  dates: WeatherHistoryDateGroup[];
}

function WeatherHistoryPositionItem(props: { pos: WeatherPosition }) {
  const pos = props.pos;
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
    <div class="weather-history-pos-item">
      <div class="weather-history-pos-item__row">
        <span class="algo-badge">{pos.outcome}</span>
        <span class={`algo-mode-badge ${pos.mode}`}>
          {pos.mode === 'real' ? 'Réel' : pos.mode === 'sim' ? 'Sim' : pos.mode}
        </span>
        <span class={`text-mono ${genericPnlClass(pos.realizedPnl)}`}>
          {formatPnlAmount(pos.realizedPnl, true)}
          <Show when={pct != null}>
            <span class="algo-pnl-pct"> ({formatPnlPercent(pct)})</span>
          </Show>
        </span>
      </div>
      <div class="weather-history-pos-item__row">
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">Bucket</span>
            {formatBucketLabel(
              wf?.entryBucketComparison ?? null,
              (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
              wf?.unit ?? null,
            )}
        </span>
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">Qté</span>
          <span class="text-mono">{qty.toFixed(4)}</span>
        </span>
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">Mise investie</span>
          <span class="text-mono">{invested.toFixed(2)} USDC</span>
        </span>
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">Prix entrée</span>
          <span class="text-mono">{pos.entryPrice.toFixed(3)}</span>
        </span>
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">Clôturé le</span>
          <span class="text-mono text-sm">
            {pos.closedAt ? formatShortDateTime(pos.closedAt) : '—'}
          </span>
        </span>
      </div>
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
    </div>
  );
}

function WeatherHistoryDateDropdown(props: { group: WeatherHistoryDateGroup; defaultOpen: boolean }) {
  const [open, setOpen] = createSignal(props.defaultOpen);
  return (
    <div class="weather-history-date-dropdown">
      <button
        type="button"
        class="weather-history-date-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open()}
      >
        <span class="weather-history-date-btn__label">
          {formatWeatherDate(props.group.targetDate)}
        </span>
        <span class="weather-history-date-btn__count">
          {props.group.positions.length} position{props.group.positions.length > 1 ? 's' : ''}
        </span>
        <Icon name={open() ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      <Show when={open()}>
        <div class="weather-history-pos-list">
          <For each={props.group.positions}>
            {(pos) => <WeatherHistoryPositionItem pos={pos} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function WeatherHistoryCityCard(props: { group: WeatherHistoryCityGroup }) {
  const carousel = useAlgoCarouselScroll(308);
  const totalPositions = () =>
    props.group.dates.reduce((sum, d) => sum + d.positions.length, 0);
  return (
    <div class="weather-history-city-card">
      <div class="weather-history-city-card__header">
        <span class="weather-history-city-card__city">{props.group.city}</span>
        <span class="weather-history-city-card__count">
          {totalPositions()} position{totalPositions() > 1 ? 's' : ''} ·{' '}
          {props.group.dates.length} date{props.group.dates.length > 1 ? 's' : ''}
        </span>
        <AlgoCarouselNav
          visible={props.group.dates.length > 0}
          onScrollLeft={carousel.scrollLeft}
          onScrollRight={carousel.scrollRight}
        />
      </div>
      <AlgoCarousel class="weather-history-city-card__dates" setScrollRef={carousel.setScrollRef}>
        <For each={props.group.dates}>
          {(date, i) => (
            <div class="weather-history-date-tile">
              <WeatherHistoryDateDropdown group={date} defaultOpen={i() === 0} />
            </div>
          )}
        </For>
      </AlgoCarousel>
    </div>
  );
}

export function WeatherAlgoPositionsPanel(props: WeatherAlgoPositionsPanelProps) {
  const p = () => props.positions;
  const [activeTab, setActiveTab] = usePersistedEnum(
    UI_KEYS.weatherAlgoPosOpenSubTab,
    'live',
    WEATHER_ALGO_POS_OPEN_SUB_TABS,
  );

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

  const historyGroups = createMemo<WeatherHistoryCityGroup[]>(() => {
    const byCity = new Map<string, Map<string, WeatherPosition[]>>();
    for (const pos of closedList()) {
      const city = pos.weatherForecast?.city ?? '—';
      const targetDate = pos.weatherForecast?.targetDate ?? '';
      let cityMap = byCity.get(city);
      if (!cityMap) {
        cityMap = new Map();
        byCity.set(city, cityMap);
      }
      let list = cityMap.get(targetDate);
      if (!list) {
        list = [];
        cityMap.set(targetDate, list);
      }
      list.push(pos);
    }
    const groups: WeatherHistoryCityGroup[] = [];
    for (const [city, cityMap] of byCity) {
      const dates: WeatherHistoryDateGroup[] = [];
      for (const [targetDate, positions] of cityMap) {
        dates.push({ targetDate, positions });
      }
      dates.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
      groups.push({ city, dates });
    }
    groups.sort((a, b) => a.city.localeCompare(b.city));
    return groups;
  });

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
              Historique ({p().historyTotal()})
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
            <div class="weather-history-grid">
              <For each={historyGroups()}>
                {(group) => <WeatherHistoryCityCard group={group} />}
              </For>
            </div>
            <div class="algo-pagination-row">
              <Show when={p().historyTotal() > 0}>
                <div class="algo-pagination">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={p().historyPage() === 0}
                    onClick={() => p().goToHistoryPage(p().historyPage() - 1)}
                    aria-label="Page précédente"
                  >
                    <Icon name="chevron-left" size={16} />
                  </button>
                  <span class="algo-pagination-info">
                    {p().historyPage() + 1} / {p().historyPageCount()}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={p().historyPage() >= p().historyPageCount() - 1}
                    onClick={() => p().goToHistoryPage(p().historyPage() + 1)}
                    aria-label="Page suivante"
                  >
                    <Icon name="chevron-right" size={16} />
                  </button>
                </div>
              </Show>
              <span class="algo-panel-count">{p().historyTotal()} positions</span>
            </div>
          </Show>
        </Show>
      </Show>
    </CollapsibleSection>
  );
}