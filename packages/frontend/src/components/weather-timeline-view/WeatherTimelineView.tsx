import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import {
  WEATHER_ALGO_TIMELINE_MAX_TICKS,
  usePersistedSignal,
} from '../../lib/ui-persistence';
import { Dialog } from '../Dialog';
import { SeriesChart } from '../WeatherSeriesChart';
import type {
  WeatherTimelineCityData,
  WeatherTimelineDateEntry,
  WeatherTimelineSource,
} from '../weather-timeline-types';
import { CityCard } from './CityCard';
import { TimelineBar } from './TimelineBar';

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
      <TimelineBar
        source={source()}
        dates={dates()}
        selectedDate={selectedDate()}
        side={side()}
        fidelity={fidelity()}
        maxTicks={maxTicks()}
        loading={loading()}
        onDateChange={onDateChange}
        onSideChange={(v) => setSide(v)}
        onFidelityChange={(v) => {
          setFidelity(v);
          if (selectedDate()) void loadTimeline(selectedDate());
        }}
        onMaxTicksChange={(v) => {
          setMaxTicks(v);
          if (selectedDate()) void loadTimeline(selectedDate());
        }}
        onRefresh={() => void loadDates()}
        canStep={canStep}
        stepDate={stepDate}
      />

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
              <Show when={source().renderDialogSummary}>
                {source().renderDialogSummary!(openCity() as TCity, side())}
              </Show>
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
