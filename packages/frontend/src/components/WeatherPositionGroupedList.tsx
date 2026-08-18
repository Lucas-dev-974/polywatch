import { createSignal, For, Show } from 'solid-js';
import type { WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { formatShortDateTime } from '../lib/date';
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
  formatWeatherDate,
  type WeatherBucketBounds,
} from '../lib/weather-position';
import { WeatherPositionMarketChartDialog } from './WeatherPositionMarketChartDialog';

export interface WeatherPositionDateGroup {
  targetDate: string;
  positions: WeatherPosition[];
}

export interface WeatherPositionCityGroup {
  city: string;
  dates: WeatherPositionDateGroup[];
}

export function buildWeatherPositionGroups(
  list: WeatherPosition[],
): WeatherPositionCityGroup[] {
  const byCity = new Map<string, Map<string, WeatherPosition[]>>();
  for (const pos of list) {
    const city = pos.weatherForecast?.city ?? '—';
    const targetDate = pos.weatherForecast?.targetDate ?? '';
    let cityMap = byCity.get(city);
    if (!cityMap) {
      cityMap = new Map();
      byCity.set(city, cityMap);
    }
    let group = cityMap.get(targetDate);
    if (!group) {
      group = [];
      cityMap.set(targetDate, group);
    }
    group.push(pos);
  }
  const groups: WeatherPositionCityGroup[] = [];
  for (const [city, cityMap] of byCity) {
    const dates: WeatherPositionDateGroup[] = [];
    for (const [targetDate, positions] of cityMap) {
      dates.push({ targetDate, positions });
    }
    dates.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    groups.push({ city, dates });
  }
  groups.sort((a, b) => a.city.localeCompare(b.city));
  return groups;
}

function WeatherPositionRow(props: {
  pos: WeatherPosition;
  onOpenChart: (pos: WeatherPosition) => void;
  onClose?: (id: number) => void;
}) {
  const pos = props.pos;
  const isOpen = pos.status === 'open';
  const wf = pos.weatherForecast;
  const invested = isOpen
    ? pos.quantity * pos.entryPrice
    : pos.entryInvestedAmount != null && pos.entryInvestedAmount > 0
      ? pos.entryInvestedAmount
      : pos.quantity * pos.entryPrice;
  const pnl = isOpen ? pos.unrealizedPnl : pos.realizedPnl;
  const pct = pnlPercent(pnl, invested);
  const qty = isOpen
    ? pos.quantity
    : pos.quantity <= 0 && pos.entryQuantityFilled != null && pos.entryQuantityFilled > 0
      ? pos.entryQuantityFilled
      : pos.quantity;
  const dateLabel = isOpen ? 'Ouvert le' : 'Clôturé le';
  const dateValue = isOpen ? pos.openedAt : pos.closedAt;
  return (
    <div class="weather-history-pos-item">
      <div class="weather-history-pos-item__row">
        <span class="algo-badge">{pos.outcome}</span>
        <span class={`algo-mode-badge ${pos.mode}`}>
          {pos.mode === 'real' ? 'Réel' : pos.mode === 'sim' ? 'Sim' : pos.mode}
        </span>
        <span class={`text-mono ${genericPnlClass(pnl)}`}>
          {formatPnlAmount(pnl, true)}
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
        <Show when={isOpen && pos.executableBidVwap != null && pos.executableBidVwap > 0 ? pos.executableBidVwap : undefined}>
          {(bid) => (
            <span class="weather-history-pos-item__metric">
              <span class="weather-history-pos-item__label">Bid actuel</span>
              <span class="text-mono">{bid().toFixed(3)}</span>
            </span>
          )}
        </Show>
        <span class="weather-history-pos-item__metric">
          <span class="weather-history-pos-item__label">{dateLabel}</span>
          <span class="text-mono text-sm">
            {dateValue ? formatShortDateTime(dateValue) : '—'}
          </span>
        </span>
        <Show when={pos.closeReason}>
          <span class="weather-history-pos-item__metric">
            <span class="weather-history-pos-item__label">Raison</span>
            <span class="text-mono text-sm badge badge-close-reason">{pos.closeReason}</span>
          </span>
        </Show>
      </div>
      <div class="weather-history-pos-item__row">
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
          type="button"
          class="btn btn-sm btn-ghost weather-position-card__link"
          onClick={() => props.onOpenChart(pos)}
        >
          Voir graph
        </button>
        <Show when={isOpen && props.onClose}>
          <button
            type="button"
            class="btn btn-sm btn-ghost weather-position-card__close"
            onClick={() => props.onClose!(pos.id)}
          >
            Fermer
          </button>
        </Show>
      </div>
    </div>
  );
}

function WeatherPositionDateDropdown(props: {
  group: WeatherPositionDateGroup;
  defaultOpen: boolean;
  onOpenChart: (pos: WeatherPosition) => void;
  onClose?: (id: number) => void;
}) {
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
            {(pos) => (
              <WeatherPositionRow
                pos={pos}
                onOpenChart={props.onOpenChart}
                onClose={props.onClose}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function WeatherPositionCityCard(props: {
  group: WeatherPositionCityGroup;
  onOpenChart: (pos: WeatherPosition) => void;
  onClose?: (id: number) => void;
}) {
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
              <WeatherPositionDateDropdown
                group={date}
                defaultOpen={true}
                onOpenChart={props.onOpenChart}
                onClose={props.onClose}
              />
            </div>
          )}
        </For>
      </AlgoCarousel>
    </div>
  );
}

export function WeatherPositionGroupedList(props: {
  groups: WeatherPositionCityGroup[];
  onClose?: (id: number) => void;
}) {
  const [chartPosition, setChartPosition] = createSignal<WeatherPosition | null>(null);
  return (
    <div class="weather-history-grid">
      <For each={props.groups}>
        {(group) => (
          <WeatherPositionCityCard
            group={group}
            onOpenChart={setChartPosition}
            onClose={props.onClose}
          />
        )}
      </For>
      <Show when={chartPosition()}>
        {(p) => (
          <WeatherPositionMarketChartDialog
            position={p()}
            onClose={() => setChartPosition(null)}
          />
        )}
      </Show>
    </div>
  );
}
