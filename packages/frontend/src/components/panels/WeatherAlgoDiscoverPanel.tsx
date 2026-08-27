import { createSignal, For, Show, type JSX } from 'solid-js';
import type {
  CityMarketGroup,
  DiscoverDateBucket,
  DiscoverMarket,
} from '../../hooks/useWeatherAlgoDashboard';
import { CollapsibleSection } from '../CollapsibleSection';

export interface WeatherAlgoDiscoverPanelProps {
  groups: CityMarketGroup[];
  loading: boolean;
  watchedCities: Set<string>;
  onRefresh: () => void;
  onWatchCity: (city: string) => void;
}

/** Match temperature buckets in Polymarket weather questions: 31°C, 28-30°C, 70°F. */
const DEGREE_RE = /(-?\d+(?:\s*-\s*-?\d+)?°[CF])/gi;

function renderQuestionWithSparkDegrees(question: string | null): JSX.Element {
  if (!question) return null;
  const parts: JSX.Element[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(DEGREE_RE.source, DEGREE_RE.flags);
  while ((match = re.exec(question)) !== null) {
    if (match.index > last) {
      parts.push(question.slice(last, match.index));
    }
    parts.push(<span class="weather-discover-card__deg">{match[1]}</span>);
    last = match.index + match[0].length;
  }
  if (last < question.length) parts.push(question.slice(last));
  if (parts.length === 0) return question;
  return <>{parts}</>;
}

function MarketCard(props: { market: DiscoverMarket }) {
  return (
    <div class="weather-discover-card">
      <div class="weather-discover-card__question">
        {renderQuestionWithSparkDegrees(props.market.question)}
      </div>
      <div class="weather-discover-card__prices">
        <For each={props.market.outcomePrices}>
          {(p) => {
            const outcome = p.outcome?.trim() ?? '';
            const kind =
              /^yes$/i.test(outcome) ? 'yes' : /^no$/i.test(outcome) ? 'no' : 'other';
            return (
              <span
                class="weather-discover-card__price"
                classList={{
                  'weather-discover-card__price--yes': kind === 'yes',
                  'weather-discover-card__price--no': kind === 'no',
                }}
              >
                <span class="weather-discover-card__outcome">{outcome}</span>
                : {(p.price * 100).toFixed(0)}%
              </span>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function DateAccordion(props: { bucket: DiscoverDateBucket; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  const forecastLabel = () => {
    if (props.bucket.forecastMean == null) return '—';
    return `${props.bucket.forecastMean.toFixed(1)}°C`;
  };

  return (
    <div
      class="weather-discover-date"
      classList={{ 'weather-discover-date--expanded': expanded() }}
    >
      <button
        type="button"
        class="weather-discover-date__header"
        onClick={() => setExpanded(!expanded())}
        aria-expanded={expanded()}
      >
        <span class="weather-city-group__chevron">{expanded() ? '▾' : '▸'}</span>
        <span class="weather-discover-date__label">{props.bucket.dateLabel}</span>
        <span
          class="weather-city-group__forecast"
          classList={{
            'weather-city-group__forecast--stale': props.bucket.forecastStatus === 'stale',
            'weather-city-group__forecast--unavailable':
              props.bucket.forecastStatus === 'unavailable',
          }}
          title={
            props.bucket.forecastStatus === 'unavailable'
              ? 'Prévision indisponible'
              : props.bucket.forecastStatus === 'stale'
                ? 'Prévision expirée'
                : undefined
          }
        >
          {forecastLabel()}
        </span>
      </button>
      <Show when={expanded()}>
        <div class="weather-discover-date__body">
          <For each={props.bucket.markets}>{(market) => <MarketCard market={market} />}</For>
        </div>
      </Show>
    </div>
  );
}

function CityAccordion(props: {
  group: CityMarketGroup;
  defaultExpanded?: boolean;
  watched: boolean;
  onWatchCity: (city: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);
  const marketCount = () =>
    props.group.dates.reduce((n, d) => n + d.markets.length, 0);

  return (
    <div
      class="weather-city-group"
      classList={{ 'weather-city-group--expanded': expanded() }}
    >
      <div class="weather-city-group__header-row">
        <button
          type="button"
          class="weather-city-group__header"
          onClick={() => setExpanded(!expanded())}
          aria-expanded={expanded()}
        >
          <span class="weather-city-group__chevron">{expanded() ? '▾' : '▸'}</span>
          <span class="weather-city-group__city">{props.group.cityLabel}</span>
          <span class="weather-city-group__count">{marketCount()}</span>
        </button>
        <div class="weather-city-group__actions" onClick={(e) => e.stopPropagation()}>
          <Show
            when={!props.watched}
            fallback={<span class="form-hint">Déjà surveillée</span>}
          >
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onClick={() => props.onWatchCity(props.group.city)}
            >
              Surveiller cette ville
            </button>
          </Show>
        </div>
      </div>
      <Show when={expanded()}>
        <div class="weather-city-group__body weather-city-group__body--nested">
          <For each={props.group.dates}>
            {(bucket, index) => (
              <DateAccordion bucket={bucket} defaultExpanded={index() === 0} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function WeatherAlgoDiscoverPanel(props: WeatherAlgoDiscoverPanelProps) {
  function isWatched(city: string): boolean {
    return props.watchedCities.has(city.trim().toLowerCase());
  }

  return (
    <CollapsibleSection
      title="Découverte marchés Polymarket"
      persistKey="polywatch_weather_discover_collapsed"
      headerActions={
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => props.onRefresh()}
          disabled={props.loading}
        >
          {props.loading ? '...' : 'Rafraîchir'}
        </button>
      }
    >
      <p class="form-hint">
        Dépliez une ville, puis une date pour voir les paliers. « Surveiller cette ville » active le
        suivi température max — l’algo choisit le bon bucket automatiquement.
      </p>

      <Show when={props.groups.length === 0 && !props.loading}>
        <div class="algo-empty">Aucun marché météo trouvé sur Polymarket.</div>
      </Show>

      <For each={props.groups}>
        {(group, index) => (
          <CityAccordion
            group={group}
            defaultExpanded={index() === 0}
            watched={isWatched(group.city)}
            onWatchCity={props.onWatchCity}
          />
        )}
      </For>
    </CollapsibleSection>
  );
}
