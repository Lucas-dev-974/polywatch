import { createSignal, For, Show } from 'solid-js';
import { api } from '../api';

interface ForecastData {
  city: string;
  forecastDate: string;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: string;
  expiresAt: string;
  isFresh: boolean;
}

export function WeatherAlgoForecastPanel() {
  const [city, setCity] = createSignal('');
  const [date, setDate] = createSignal('');
  const [metric, setMetric] = createSignal('highest_temp');
  const [forecast, setForecast] = createSignal<ForecastData | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function fetchForecast() {
    const c = city().trim();
    const d = date().trim();
    if (!c || !d) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<ForecastData>(
        `/weather-algo-forecasts/${encodeURIComponent(c)}/${encodeURIComponent(d)}?metric=${metric()}`,
      );
      setForecast(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Prévisions météo</h2>
      </div>
      <div class="weather-forecast-form">
        <input type="text" placeholder="Ville (ex: Jinan)" value={city()}
          onInput={(e) => setCity(e.currentTarget.value)} />
        <input type="date" value={date()}
          onInput={(e) => setDate(e.currentTarget.value)} />
        <select value={metric()} onChange={(e) => setMetric(e.currentTarget.value)}>
          <option value="highest_temp">Temp max</option>
          <option value="lowest_temp">Temp min</option>
        </select>
        <button class="btn btn-sm btn-primary" onClick={() => fetchForecast()} disabled={loading()}>
          {loading() ? '...' : 'Obtenir'}
        </button>
      </div>
      <Show when={error()}>
        <div class="algo-empty">Erreur: {error()}</div>
      </Show>
      <Show when={forecast()}>
        {(f) => (
          <div class="weather-forecast-result">
            <div class="weather-forecast-summary">
              <span>Mean: {f().forecastMean.toFixed(1)}°C</span>
              <span>StdDev: {f().forecastStdDev.toFixed(2)}°C</span>
              <span classList={{ 'weather-forecast-stale': !f().isFresh }}>
                {f().isFresh ? 'Frais' : 'Expiré'}
              </span>
            </div>
            <div class="weather-forecast-models">
              <For each={Object.entries(f().modelValues)}>
                {([model, value]) => (
                  <span class="weather-forecast-model">{model}: {value.toFixed(1)}°C</span>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}