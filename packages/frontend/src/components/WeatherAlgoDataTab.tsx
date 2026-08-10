import { createSignal, For, onMount, Show } from 'solid-js';
import {
  deleteWeatherAlgoDataTables,
  fetchWeatherAlgoBucketTicks,
  fetchWeatherAlgoClobPriceHistory,
  fetchWeatherAlgoDataTables,
  fetchWeatherAlgoEvaluationLog,
  fetchWeatherAlgoForecastCache,
  fetchWeatherAlgoForecastHistory,
  fetchWeatherAlgoMarketSnapshots,
  fetchWeatherAlgoPositionForecasts,
  fetchWeatherConfig,
  type WeatherAlgoDataTableId,
  type WeatherAlgoDataTableSummary,
} from '../api';
import {
  UI_KEYS,
  WEATHER_ALGO_DATA_DETAIL_MODES,
  WEATHER_ALGO_DATA_TABLE_IDS,
  WEATHER_ALGO_DATA_VIEWS,
  usePersistedEnum,
  usePersistedSignal,
  type WeatherAlgoDataView,
} from '../lib/ui-persistence';
import { WeatherBucketTimelineView } from './WeatherBucketTimelineView';
import { WeatherClobTimelineView } from './WeatherClobTimelineView';

const PAGE_SIZE = 50;
const DEFAULT_POLL_MS = 1_800_000;

interface TableMeta {
  title: string;
  description: string;
  dateLabel: string;
  hasCity: boolean;
  hasDateRange: boolean;
  hasConditionId?: boolean;
  hasStrategyFilters?: boolean;
  /** Cadence d'écriture ; `pollMs` = weatherAlgoPollMs courant. */
  cadence: (pollMs: number) => string;
}

function formatPollInterval(pollMs: number): string {
  if (!Number.isFinite(pollMs) || pollMs <= 0) return 'intervalle de poll';
  if (pollMs >= 3_600_000) {
    const h = pollMs / 3_600_000;
    return h === 1 ? '1 h' : `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  if (pollMs >= 60_000) {
    const m = pollMs / 60_000;
    return m === 1 ? '1 min' : `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
  }
  const s = Math.max(1, Math.round(pollMs / 1000));
  return s === 1 ? '1 s' : `${s} s`;
}

const TABLE_META: Record<WeatherAlgoDataTableId, TableMeta> = {
  forecast_history: {
    title: 'Forecast history',
    description:
      'Historique append-only des fetchs Open-Meteo (révisions forecast pour backtest).',
    dateLabel: 'Fetch',
    hasCity: true,
    hasDateRange: true,
    cadence: (pollMs) =>
      `À chaque fetch Open-Meteo réel (pas cache hit) — au plus 1× / ${formatPollInterval(pollMs)}`,
  },
  market_snapshots: {
    title: 'Market snapshots',
    description:
      'Un snapshot par cycle × ville × date (contexte forecast + compteurs buckets).',
    dateLabel: 'Enregistrement',
    hasCity: true,
    hasDateRange: true,
    cadence: (pollMs) =>
      `Chaque cycle d’évaluation — 1× / ${formatPollInterval(pollMs)} par ville suivie × date`,
  },
  bucket_ticks: {
    title: 'Bucket ticks',
    description: 'Prix YES/NO de chaque bucket actif lié à un snapshot.',
    dateLabel: 'Enregistrement',
    hasCity: true,
    hasDateRange: true,
    hasConditionId: true,
    cadence: (pollMs) =>
      `Avec chaque snapshot — 1× / ${formatPollInterval(pollMs)} par bucket actif`,
  },
  evaluation_log: {
    title: 'Evaluation log',
    description: 'Décisions signal/abstain par bucket × stratégie.',
    dateLabel: 'Évaluation',
    hasCity: false,
    hasDateRange: true,
    hasStrategyFilters: true,
    cadence: (pollMs) =>
      `Chaque cycle — 1× / ${formatPollInterval(pollMs)} par bucket × stratégie`,
  },
  forecast_cache: {
    title: 'Forecast cache',
    description: 'Cache opérationnel upsert (état courant, pas l’historique).',
    dateLabel: 'Fetch',
    hasCity: true,
    hasDateRange: true,
    cadence: () => 'Upsert à chaque fetch Open-Meteo (remplace la ligne ville × date)',
  },
  position_forecasts: {
    title: 'Position forecasts',
    description: 'Snapshot forecast figé à l’ouverture d’une position weather.',
    dateLabel: 'Ouverture position (si connue)',
    hasCity: true,
    hasDateRange: true,
    cadence: () => 'Événementiel — 1 ligne à l’ouverture d’une position (pas de poll)',
  },
  clob_price_history: {
    title: 'Historique prix Polymarket',
    description:
      'Séries de prix YES/NO par bucket chargées depuis l’API Polymarket (section Villes → Données enregistrées).',
    dateLabel: 'Enregistrement',
    hasCity: true,
    hasDateRange: true,
    cadence: () => 'À la demande — ingestion historique par ville et période',
  },
};

function formatTs(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function formatTsCompact(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNum(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function truncate(value: string | null | undefined, max = 18): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function isPersistedString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function WeatherAlgoDataTab() {
  const [view, setView] = usePersistedEnum(
    UI_KEYS.weatherAlgoDataView,
    'grid',
    WEATHER_ALGO_DATA_VIEWS,
  );
  const [selectedId, setSelectedId] = usePersistedSignal<WeatherAlgoDataTableId | null>(
    UI_KEYS.weatherAlgoDataTableId,
    null,
    (value): value is WeatherAlgoDataTableId | null =>
      value === null ||
      (typeof value === 'string' &&
        (WEATHER_ALGO_DATA_TABLE_IDS as readonly string[]).includes(value)),
  );
  const [tables, setTables] = createSignal<WeatherAlgoDataTableSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = createSignal(false);
  const [summaryError, setSummaryError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const [pollMs, setPollMs] = createSignal(DEFAULT_POLL_MS);

  const [city, setCity] = usePersistedSignal(UI_KEYS.weatherAlgoDataCity, '', isPersistedString);
  const [from, setFrom] = usePersistedSignal(UI_KEYS.weatherAlgoDataFrom, '', isPersistedString);
  const [to, setTo] = usePersistedSignal(UI_KEYS.weatherAlgoDataTo, '', isPersistedString);
  const [conditionId, setConditionId] = usePersistedSignal(
    UI_KEYS.weatherAlgoDataConditionId,
    '',
    isPersistedString,
  );
  const [strategyId, setStrategyId] = usePersistedSignal(
    UI_KEYS.weatherAlgoDataStrategyId,
    '',
    isPersistedString,
  );
  const [decision, setDecision] = usePersistedSignal(
    UI_KEYS.weatherAlgoDataDecision,
    '',
    isPersistedString,
  );
  const [page, setPage] = usePersistedSignal(UI_KEYS.weatherAlgoDataPage, 0, isNonNegativeInt);
  const [total, setTotal] = createSignal(0);
  const [rows, setRows] = createSignal<Record<string, unknown>[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);
  const [detailMode, setDetailMode] = usePersistedEnum(
    UI_KEYS.weatherAlgoDataDetailMode,
    'list',
    WEATHER_ALGO_DATA_DETAIL_MODES,
  );

  async function refreshSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetchWeatherAlgoDataTables();
      setTables(res.tables);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Résumé indisponible');
    }
    setSummaryLoading(false);
  }

  async function loadDetail(pageOverride?: number, tableId?: WeatherAlgoDataTableId) {
    const id = tableId ?? selectedId();
    if (!id) return;
    const pageIndex = pageOverride ?? page();
    setDetailLoading(true);
    setDetailError(null);
    const offset = pageIndex * PAGE_SIZE;
    const base = {
      city: city().trim() || undefined,
      from: from() || undefined,
      to: to() || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    try {
      let result: { items: unknown[]; total: number };
      switch (id) {
        case 'forecast_history':
          result = await fetchWeatherAlgoForecastHistory(base);
          break;
        case 'market_snapshots':
          result = await fetchWeatherAlgoMarketSnapshots({
            ...base,
            includeTicks: false,
          });
          break;
        case 'bucket_ticks':
          result = await fetchWeatherAlgoBucketTicks({
            ...base,
            conditionId: conditionId().trim() || undefined,
          });
          break;
        case 'evaluation_log':
          result = await fetchWeatherAlgoEvaluationLog({
            from: base.from,
            to: base.to,
            strategyId: strategyId().trim() || undefined,
            decision: decision().trim() || undefined,
            limit: base.limit,
            offset: base.offset,
          });
          break;
        case 'forecast_cache':
          result = await fetchWeatherAlgoForecastCache(base);
          break;
        case 'position_forecasts':
          result = await fetchWeatherAlgoPositionForecasts(base);
          break;
        case 'clob_price_history':
          result = await fetchWeatherAlgoClobPriceHistory(base);
          break;
      }
      setRows(result.items as Record<string, unknown>[]);
      setTotal(result.total);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Chargement impossible');
      setRows([]);
      setTotal(0);
    }
    setDetailLoading(false);
  }

  onMount(() => {
    void refreshSummary();
    void fetchWeatherConfig()
      .then((cfg) => {
        if (typeof cfg.weatherAlgoPollMs === 'number' && cfg.weatherAlgoPollMs > 0) {
          setPollMs(cfg.weatherAlgoPollMs);
        }
      })
      .catch(() => {
        /* keep default poll cadence */
      });

    const restoredView: WeatherAlgoDataView = view();
    const restoredId = selectedId();
    if (restoredView === 'detail' && restoredId) {
      void loadDetail(page(), restoredId);
    } else if (restoredView === 'detail' && !restoredId) {
      setView('grid');
    }
  });

  function totalRows(): number {
    return tables().reduce((sum, t) => sum + t.rowCount, 0);
  }

  async function deleteAllData() {
    const total = totalRows();
    if (
      !confirm(
        'Supprimer toutes les données des 7 tables weather ?\n\n' +
          `${total.toLocaleString()} ligne(s) seront effacées (history, snapshots, ticks, eval log, cache, position forecasts, historique prix Polymarket).\n` +
          'Cette action est irréversible. Les prochains cycles du weather-algo pourront réenregistrer des données.',
      )
    ) {
      return;
    }
    setDeleting(true);
    setSummaryError(null);
    try {
      await deleteWeatherAlgoDataTables();
      await refreshSummary();
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : 'Échec de la suppression',
      );
    }
    setDeleting(false);
  }

  function openDetail(id: WeatherAlgoDataTableId) {
    setSelectedId(id);
    setCity('');
    setFrom('');
    setTo('');
    setConditionId('');
    setStrategyId('');
    setDecision('');
    setPage(0);
    setRows([]);
    setTotal(0);
    setDetailError(null);
    setDetailMode(id === 'clob_price_history' ? 'timeline' : 'list');
    setView('detail');
    void loadDetail(0, id);
  }

  function backToGrid() {
    setView('grid');
    setSelectedId(null);
    void refreshSummary();
  }

  function applyFilters() {
    setPage(0);
    void loadDetail(0);
  }

  function goToPage(next: number) {
    setPage(next);
    void loadDetail(next);
  }

  function pageCount(): number {
    return Math.max(1, Math.ceil(total() / PAGE_SIZE));
  }

  const selectedMeta = () => {
    const id = selectedId();
    return id ? TABLE_META[id] : null;
  };

  const selectedSummary = () => tables().find((t) => t.id === selectedId()) ?? null;

  return (
    <div class="weather-algo-data-tab">
      <Show when={view() === 'grid'}>
        <div class="weather-data-toolbar">
          <h3 class="settings-subheading">Tables de données</h3>
          <div class="weather-data-toolbar-actions">
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              onClick={() => void refreshSummary()}
              disabled={summaryLoading() || deleting()}
            >
              {summaryLoading() ? '...' : 'Actualiser'}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-danger"
              onClick={() => void deleteAllData()}
              disabled={deleting() || summaryLoading() || totalRows() === 0}
              title="Supprimer toutes les lignes des 7 tables"
            >
              {deleting() ? 'Suppression…' : 'Tout supprimer'}
            </button>
          </div>
        </div>
        <Show when={summaryError()}>
          <p class="form-hint weather-settings-error">{summaryError()}</p>
        </Show>
        <div class="weather-data-cards">
          <For each={tables()}>
            {(table) => {
              const meta = TABLE_META[table.id];
              const empty = table.rowCount === 0;
              return (
                <button
                  type="button"
                  class={`weather-data-card${empty ? ' weather-data-card--empty' : ''}`}
                  onClick={() => openDetail(table.id)}
                >
                  <div class="weather-data-card-header">
                    <div class="weather-data-card-heading">
                      <span class="weather-data-card-title">{meta.title}</span>
                      <code class="weather-data-card-table">{table.tableName}</code>
                    </div>
                    <span
                      class={`weather-data-card-count${empty ? ' weather-data-card-count--empty' : ''}`}
                    >
                      {table.rowCount.toLocaleString()}
                      <span class="weather-data-card-count-unit">lignes</span>
                    </span>
                  </div>
                  <p class="weather-data-card-desc">{meta.description}</p>
                  <div class="weather-data-card-cadence">
                    <span class="weather-data-card-cadence-label">Cadence</span>
                    <span class="weather-data-card-cadence-value">{meta.cadence(pollMs())}</span>
                  </div>
                  <dl class="weather-data-card-stats">
                    <div>
                      <dt>Plus ancienne</dt>
                      <dd title={formatTs(table.oldestAt)}>{formatTsCompact(table.oldestAt)}</dd>
                    </div>
                    <div>
                      <dt>Plus récente</dt>
                      <dd title={formatTs(table.newestAt)}>{formatTsCompact(table.newestAt)}</dd>
                    </div>
                    <div class="weather-data-card-cta" aria-hidden="true">
                      <span>Ouvrir</span>
                      <span class="weather-data-card-cta-arrow">→</span>
                    </div>
                  </dl>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={view() === 'detail' && selectedMeta()}>
        {(meta) => (
          <div class="weather-data-detail">
            <div class="weather-data-toolbar">
              <div class="weather-data-detail-heading">
                <button type="button" class="btn btn-sm btn-ghost" onClick={backToGrid}>
                  ← Retour
                </button>
                <div class="weather-data-detail-title-row">
                  <h3 class="settings-subheading">{meta().title}</h3>
                  <div class="weather-data-card-table">
                    {selectedSummary()?.tableName ?? selectedId()}
                  </div>
                </div>
              </div>
              <span class="algo-panel-count">{total().toLocaleString()} lignes</span>
            </div>

            <Show when={selectedId() === 'bucket_ticks' || selectedId() === 'clob_price_history'}>
              <div class="weather-data-mode-toggle" role="tablist">
                {(['list', 'timeline'] as const).map((mode) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailMode() === mode}
                    class={`weather-data-mode-btn${detailMode() === mode ? ' active' : ''}`}
                    onClick={() => setDetailMode(mode)}
                  >
                    {mode === 'list' ? 'Liste' : 'Timeline'}
                  </button>
                ))}
              </div>
            </Show>

            <Show
              when={
                (selectedId() !== 'bucket_ticks' && selectedId() !== 'clob_price_history') ||
                detailMode() === 'list'
              }
            >
            <form
              class="weather-data-filters"
              onSubmit={(e) => {
                e.preventDefault();
                applyFilters();
              }}
            >
              <Show when={meta().hasCity}>
                <label class="weather-data-filter">
                  <span>Ville</span>
                  <input
                    type="text"
                    value={city()}
                    onInput={(e) => setCity(e.currentTarget.value)}
                    placeholder="ex. london"
                  />
                </label>
              </Show>
              <Show when={meta().hasDateRange}>
                <label class="weather-data-filter">
                  <span>Du</span>
                  <input
                    type="date"
                    value={from() ? toDateInputValue(from()) : ''}
                    onInput={(e) => {
                      const v = e.currentTarget.value;
                      setFrom(v ? new Date(`${v}T00:00:00.000Z`).toISOString() : '');
                    }}
                  />
                </label>
                <label class="weather-data-filter">
                  <span>Au</span>
                  <input
                    type="date"
                    value={to() ? toDateInputValue(to()) : ''}
                    onInput={(e) => {
                      const v = e.currentTarget.value;
                      setTo(v ? new Date(`${v}T23:59:59.999Z`).toISOString() : '');
                    }}
                  />
                </label>
              </Show>
              <Show when={meta().hasConditionId}>
                <label class="weather-data-filter weather-data-filter-wide">
                  <span>conditionId</span>
                  <input
                    type="text"
                    value={conditionId()}
                    onInput={(e) => setConditionId(e.currentTarget.value)}
                  />
                </label>
              </Show>
              <Show when={meta().hasStrategyFilters}>
                <label class="weather-data-filter">
                  <span>strategyId</span>
                  <input
                    type="text"
                    value={strategyId()}
                    onInput={(e) => setStrategyId(e.currentTarget.value)}
                  />
                </label>
                <label class="weather-data-filter">
                  <span>decision</span>
                  <input
                    type="text"
                    value={decision()}
                    onInput={(e) => setDecision(e.currentTarget.value)}
                    placeholder="signal | abstain"
                  />
                </label>
              </Show>
              <button type="submit" class="btn btn-sm btn-secondary">
                Filtrer
              </button>
            </form>

            <Show when={detailError()}>
              <p class="form-hint weather-settings-error">{detailError()}</p>
            </Show>

            <div class="weather-data-table-wrap">
              <Show when={detailLoading()}>
                <p class="form-hint">Chargement…</p>
              </Show>
              <Show when={!detailLoading()}>
                <Show
                  when={rows().length > 0}
                  fallback={<p class="form-hint">Aucune ligne</p>}
                >
                  <table class="weather-data-table">
                    <thead>
                      <DetailHeaders id={selectedId()!} />
                    </thead>
                    <tbody>
                      <For each={rows()}>
                        {(row) => <DetailRow id={selectedId()!} row={row} />}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </Show>
            </div>

            <Show when={total() > 0}>
              <div class="algo-pagination weather-data-pagination">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  disabled={page() === 0 || detailLoading()}
                  onClick={() => goToPage(Math.max(0, page() - 1))}
                >
                  Préc.
                </button>
                <span class="algo-pagination-info">
                  {page() + 1} / {pageCount()}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  disabled={page() >= pageCount() - 1 || detailLoading()}
                  onClick={() => goToPage(page() + 1)}
                >
                  Suiv.
                </button>
              </div>
            </Show>
            </Show>

            <Show when={selectedId() === 'bucket_ticks' && detailMode() === 'timeline'}>
              <WeatherBucketTimelineView />
            </Show>

            <Show when={selectedId() === 'clob_price_history' && detailMode() === 'timeline'}>
              <WeatherClobTimelineView />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function DetailHeaders(props: { id: WeatherAlgoDataTableId }) {
  const headers: Record<WeatherAlgoDataTableId, string[]> = {
    forecast_history: ['Ville', 'Date forecast', 'Mean', 'Std', 'Fetched'],
    market_snapshots: ['Ville', 'Date cible', 'Mean', 'Buckets', 'Recorded'],
    bucket_ticks: ['Ville', 'conditionId', 'YES', 'NO', 'Bucket', 'Recorded'],
    evaluation_log: ['Stratégie', 'Décision', 'Edge', 'Prob', 'Evaluated'],
    forecast_cache: ['Ville', 'Date forecast', 'Mean', 'Expires', 'Fetched'],
    position_forecasts: [
      'Ville',
      'Date cible',
      'Entry mean',
      'Position',
      'Ouverture',
      'Bucket',
    ],
    clob_price_history: [
      'Ville',
      'Date cible',
      'Côté',
      'Prix',
      'Bucket',
      'Recorded',
    ],
  };
  return (
    <tr>
      <For each={headers[props.id]}>{(h) => <th>{h}</th>}</For>
    </tr>
  );
}

function DetailRow(props: { id: WeatherAlgoDataTableId; row: Record<string, unknown> }) {
  const r = props.row;
  const str = (key: string) => {
    const v = r[key];
    if (v == null) return '—';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    return String(v);
  };
  const num = (key: string) => formatNum(r[key] as number | null);
  const ts = (key: string) => formatTs(r[key] as string | null);

  switch (props.id) {
    case 'forecast_history':
      return (
        <tr>
          <td>{str('city')}</td>
          <td>{ts('forecastDate')}</td>
          <td>{num('forecastMean')}</td>
          <td>{num('forecastStdDev')}</td>
          <td>{ts('fetchedAt')}</td>
        </tr>
      );
    case 'market_snapshots':
      return (
        <tr>
          <td>{str('cityNormalized')}</td>
          <td>{str('targetDateIso')}</td>
          <td>{num('forecastMean')}</td>
          <td>
            {str('bucketCount')}/{str('totalBucketCount')}
          </td>
          <td>{ts('recordedAt')}</td>
        </tr>
      );
    case 'bucket_ticks': {
      const bounds = [r.bucketLow, r.bucketTarget, r.bucketHigh].filter((x) => x != null);
      return (
        <tr>
          <td>{str('cityNormalized')}</td>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{num('yesPrice')}</td>
          <td>{num('noPrice')}</td>
          <td>
            {str('bucketComparison')}
            {bounds.length > 0 ? ` (${bounds.join('/')})` : ''}
          </td>
          <td>{ts('recordedAt')}</td>
        </tr>
      );
    }
    case 'evaluation_log':
      return (
        <tr>
          <td>{str('strategyId')}</td>
          <td>{str('decision')}</td>
          <td>{num('edge')}</td>
          <td>{num('forecastProb')}</td>
          <td>{ts('evaluatedAt')}</td>
        </tr>
      );
    case 'forecast_cache':
      return (
        <tr>
          <td>{str('city')}</td>
          <td>{ts('forecastDate')}</td>
          <td>{num('forecastMean')}</td>
          <td>{ts('expiresAt')}</td>
          <td>{ts('fetchedAt')}</td>
        </tr>
      );
    case 'position_forecasts':
      return (
        <tr>
          <td>{str('city')}</td>
          <td>{ts('targetDate')}</td>
          <td>{num('entryForecastMean')}</td>
          <td class="text-mono">{str('copiedPositionId')}</td>
          <td>{ts('openedAt')}</td>
          <td>{str('entryBucketComparison')}</td>
        </tr>
      );
    case 'clob_price_history': {
      const bounds = [r.bucketLow, r.bucketTarget, r.bucketHigh].filter((x) => x != null);
      return (
        <tr>
          <td>{str('city')}</td>
          <td>{str('targetDate')}</td>
          <td>{str('side')}</td>
          <td>{num('price')}</td>
          <td>
            {str('bucketComparison')}
            {bounds.length > 0 ? ` (${bounds.join('/')})` : ''}
          </td>
          <td>{ts('recordedAt')}</td>
        </tr>
      );
    }
  }
}
