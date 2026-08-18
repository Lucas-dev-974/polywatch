import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import {
  UI_KEYS,
  WEATHER_ALGO_TIMELINE_MAX_TICKS,
  usePersistedSignal,
} from '../lib/ui-persistence';
import { Dialog } from './Dialog';
import { SeriesChart } from './WeatherSeriesChart';
import type {
  WeatherTimelineCityData,
  WeatherTimelineDateEntry,
  WeatherTimelineSource,
} from './weather-timeline-types';

export { UI_KEYS };
export type {
  WeatherTimelineDateEntry,
  WeatherTimelineSeriesPoint,
  WeatherTimelineBucketData,
  WeatherTimelineCityData,
  WeatherTimelineSideOption,
  WeatherTimelineSource,
} from './weather-timeline-types';
export { SeriesChart, type SeriesChartMarker } from './WeatherSeriesChart';

function formatChartTime(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CityCard<T>(props: {
  city: WeatherTimelineCityData<T>;
  unitLabel: string;
  renderExtra?: () => JSX.Element;
  onClick: () => void;
}) {
  const c = props.city;
  return (
    <button type="button" class="weather-data-card" onClick={props.onClick}>
      <div class="weather-data-card-header">
        <div class="weather-data-card-heading">
          <span class="weather-data-card-title">{c.key}</span>
          <code class="weather-data-card-table">
            {c.bucketCount} bucket{c.bucketCount > 1 ? 's' : ''}
          </code>
        </div>
        <span class="weather-data-card-count">{c.bucketCount}</span>
      </div>
      <Show when={props.renderExtra}>{props.renderExtra!()}</Show>
      <dl class="weather-data-card-stats">
        <div>
          <dt>Premier {props.unitLabel}</dt>
          <dd>{formatChartTime(new Date(c.firstRecordedAt).getTime(), 0)}</dd>
        </div>
        <div>
          <dt>Dernier {props.unitLabel}</dt>
          <dd>{formatChartTime(new Date(c.lastRecordedAt).getTime(), 0)}</dd>
        </div>
        <div class="weather-data-card-cta" aria-hidden="true">
          <span>Voir</span>
          <span class="weather-data-card-cta-arrow">→</span>
        </div>
      </dl>
    </button>
  );
}

export function WeatherTimelineView<TCity extends object>(
  props: { source: WeatherTimelineSource<TCity> },
): JSX.Element {
  const source = () => props.source;
  let loadToken = 0;
  const [dates, setDates] = createSignal<WeatherTimelineDateEntry[]>([]);
  const [selectedDate, setSelectedDate] = usePersistedSignal(
    source().dateKey,
    '',
    (value): value is string => typeof value === 'string',
  );
  const [side, setSide] = usePersistedSignal<string>(
    source().sideKey ?? '__unused__',
    source().sideDefault ?? '',
    (value): value is string => typeof value === 'string',
  );
  const [cities, setCities] = createSignal<object[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [openCity, setOpenCity] = createSignal<object | null>(null);
  const [maxTicks, setMaxTicks] = usePersistedSignal(
    source().maxTicksKey,
    2000,
    (value): value is number =>
      typeof value === 'number' &&
      (WEATHER_ALGO_TIMELINE_MAX_TICKS as readonly number[]).includes(value),
  );
  const [minPrice, setMinPrice] = usePersistedSignal(
    source().minPriceKey ?? '__unused__',
    source().minPriceDefault ?? 0,
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  const [fidelity, setFidelity] = usePersistedSignal<string>(
    source().fidelityKey ?? '__unused__',
    source().fidelityDefault ?? '',
    (value): value is string => typeof value === 'string',
  );

  // Quand l'intervalle est obligatoire (fidelityRequired), on force une valeur
  // non vide : une valeur persistée "" (ou stale) serait sinon utilisée pour
  // charger tous les intervalles, contredisant la contrainte « pas de Tous ».
  if (source().fidelityRequired && !fidelity()) {
    setFidelity(source().fidelityDefault ?? source().fidelityOptions?.[0]?.value ?? '');
  }

  async function loadDates() {
    try {
      const res = await source().fetchDates();
      setDates(res);
      if (res.length === 0) return;
      const current = selectedDate();
      const match = res.some((d) => d.key === current);
      if (!match) {
        setSelectedDate(res[0]!.key);
        void loadTimeline(res[0]!.key);
      } else {
        void loadTimeline(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dates indisponibles');
    }
  }

  async function loadTimeline(dateKey: string) {
    const token = ++loadToken;
    setLoading(true);
    setError(null);
    setCities([]);
    setOpenCity(null);
    try {
      const res = await source().fetchTimeline(dateKey, maxTicks(), fidelity());
      if (token !== loadToken) return;
      setCities(res as unknown as object[]);
    } catch (err) {
      if (token !== loadToken) return;
      setError(err instanceof Error ? err.message : 'Timeline indisponible');
    }
    if (token !== loadToken) return;
    setLoading(false);
  }

  onMount(() => {
    void loadDates();
  });

  function onDateChange(value: string) {
    setSelectedDate(value);
    if (value) void loadTimeline(value);
  }

  function dateIndex(): number {
    return dates().findIndex((d) => d.key === selectedDate());
  }

  function canStep(dir: number): boolean {
    const i = dateIndex();
    if (i < 0) return false;
    const next = i + dir;
    return next >= 0 && next < dates().length;
  }

  function stepDate(dir: number) {
    const i = dateIndex();
    if (i < 0) return;
    const next = dates()[i + dir];
    if (next) onDateChange(next.key);
  }

  const openCityData = () =>
    openCity() ? source().toCityData(openCity() as TCity, side()) : null;

  return (
    <div class="weather-bucket-timeline-view">
      <div class="weather-bucket-timeline-bar">
        <div class="weather-bucket-timeline-date">
          <span class="weather-data-filter-label">Date cible</span>
          <div class="weather-bucket-timeline-date-control">
            <button
              type="button"
              class="weather-bucket-timeline-step"
              aria-label="Date précédente"
              onClick={() => stepDate(-1)}
              disabled={loading() || !canStep(-1)}
            >
              ‹
            </button>
            <select
              class="weather-bucket-timeline-date-select"
              value={selectedDate()}
              onChange={(e) => onDateChange(e.currentTarget.value)}
              disabled={loading()}
            >
              <Show when={dates().length === 0}>
                <option value="">Aucune date</option>
              </Show>
              <For each={dates()}>
                {(d) => <option value={d.key}>{d.label}</option>}
              </For>
            </select>
            <button
              type="button"
              class="weather-bucket-timeline-step"
              aria-label="Date suivante"
              onClick={() => stepDate(1)}
              disabled={loading() || !canStep(1)}
            >
              ›
            </button>
          </div>
        </div>
        <Show when={source().sideOptions}>
          <label class="weather-data-filter">
            <span>Côté</span>
            <select
              value={side()}
              onChange={(e) => setSide(e.currentTarget.value)}
              disabled={loading()}
            >
              <For each={source().sideOptions!}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={source().fidelityOptions}>
          <label class="weather-data-filter">
            <span>Intervalle</span>
            <select
              value={fidelity()}
              onChange={(e) => {
                setFidelity(e.currentTarget.value);
                if (selectedDate()) void loadTimeline(selectedDate());
              }}
              disabled={loading()}
            >
              <Show when={!source().fidelityRequired}>
                <option value="">Tous</option>
              </Show>
              <For each={source().fidelityOptions!}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <div class="weather-bucket-timeline-maxticks">
          <span class="weather-data-filter-label">Points max</span>
          <div class="weather-bucket-timeline-segmented" role="group" aria-label="Points max">
            <For each={WEATHER_ALGO_TIMELINE_MAX_TICKS}>
              {(v) => (
                <button
                  type="button"
                  class={`weather-bucket-timeline-seg-btn${maxTicks() === v ? ' active' : ''}`}
                  onClick={() => {
                    setMaxTicks(v);
                    if (selectedDate()) void loadTimeline(selectedDate());
                  }}
                  disabled={loading()}
                >
                  {v.toLocaleString()}
                </button>
              )}
            </For>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onClick={() => void loadDates()}>
          Actualiser
        </button>
      </div>

      <Show when={error()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p class="form-hint">Chargement…</p>
      </Show>

      <Show when={!loading() && selectedDate() && cities().length > 0}>
        <div class="weather-data-cards">
          <For each={cities()}>
            {(city) => {
              const raw = city as TCity;
              const cityData = source().toCityData(raw, side());
              return (
                <CityCard
                  city={cityData}
                  unitLabel={source().unitLabel}
                  renderExtra={
                    source().renderCityCardExtra
                      ? () => source().renderCityCardExtra!(raw)
                      : undefined
                  }
                  onClick={() => setOpenCity(city)}
                />
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={!loading() && selectedDate() && cities().length === 0}>
        <p class="form-hint">Aucune ville enregistrée pour cette date cible.</p>
      </Show>

      <Dialog
        open={openCity() !== null}
        onClose={() => setOpenCity(null)}
        title={
          openCityData()
            ? `${openCityData()!.key} — ${selectedDate()}`
            : 'Détail ville'
        }
        titleId={source().dialogTitleId}
        class="weather-bucket-dialog"
        bodyClass="weather-bucket-dialog-body"
      >
        <Show when={openCity() && openCityData()}>
          {(c) => (
            <>
              {source().renderDialogSummary(openCity() as TCity, side())}
              <Show when={source().minPriceKey}>
                <label class="weather-data-filter weather-bucket-min-price">
                  <span>Prix min</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={minPrice()}
                    onInput={(e) => {
                      const v = Number(e.currentTarget.value);
                      setMinPrice(
                        Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0,
                      );
                    }}
                    title="N’afficher que les buckets dont le prix moyen (hors zéros de fin de vie) dépasse ce seuil (0 à 1)"
                  />
                </label>
              </Show>
              <SeriesChart
                buckets={c().buckets}
                minPrice={minPrice()}
                renderHeader={(totalPoints) =>
                  source().renderChartHeader(openCity() as TCity, side(), totalPoints)
                }
              />
            </>
          )}
        </Show>
      </Dialog>
    </div>
  );
}
