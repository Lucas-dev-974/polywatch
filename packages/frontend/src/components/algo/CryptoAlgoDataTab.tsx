import { createSignal, For, onMount, Show } from 'solid-js';
import {
  deleteCryptoAlgoDataTable,
  deleteCryptoAlgoDataTables,
  fetchCryptoAlgoAutoTrackRules,
  fetchCryptoAlgoDataTables,
  fetchCryptoAlgoExecutions,
  fetchCryptoAlgoMarketSelections,
  fetchCryptoAlgoPositions,
  fetchCryptoAlgoPostEntryMidSamples,
  fetchCryptoAlgoPriceTicks,
  fetchCryptoAlgoSurveillanceSnapshots,
  type CryptoAlgoAutoTrackRuleRow,
  type CryptoAlgoDataTableSummary,
  type CryptoAlgoExecutionRow,
  type CryptoAlgoMarketSelectionRow,
  type CryptoAlgoPositionRow,
  type CryptoAlgoPostEntryMidSampleRow,
  type CryptoAlgoPriceTickRow,
  type CryptoAlgoSurveillanceSnapshotRow,
} from '../../api';
import {
  CRYPTO_ALGO_DATA_TABLE_IDS,
  CRYPTO_ALGO_DATA_VIEWS,
  UI_KEYS,
  usePersistedEnum,
  usePersistedSignal,
  type CryptoAlgoDataTableId,
  type CryptoAlgoDataView,
} from '../../lib/ui-persistence';
import { Pagination } from '../Pagination';
import { formatNum, formatTs, formatTsCompact } from '../../lib/format';

/** Union des lignes de détail par table. */
type CryptoAlgoDataRow =
  | CryptoAlgoPriceTickRow
  | CryptoAlgoSurveillanceSnapshotRow
  | CryptoAlgoPostEntryMidSampleRow
  | CryptoAlgoMarketSelectionRow
  | CryptoAlgoAutoTrackRuleRow
  | CryptoAlgoExecutionRow
  | CryptoAlgoPositionRow;

const PAGE_SIZE = 50;

interface TableMeta {
  title: string;
  description: string;
  dateLabel: string;
  hasConditionId: boolean;
  hasMode: boolean;
  hasStatus: boolean;
  hasDateRange: boolean;
  cadence: string;
}

const TABLE_META: Record<CryptoAlgoDataTableId, TableMeta> = {
  price_ticks: {
    title: 'Price ticks',
    description:
      'Séries de prix YES/NO (~1 Hz) enregistrées par le crypto-algo pour chaque marché actif.',
    dateLabel: 'Enregistrement',
    hasConditionId: true,
    hasMode: false,
    hasStatus: false,
    hasDateRange: true,
    cadence: 'Chaque tick du price feed — ~1× / s par marché actif',
  },
  surveillance_snapshots: {
    title: 'Surveillance snapshots',
    description:
      'Snapshots open/close des marchés Up/Down auto-suivis (prix, vainqueur, positions figées).',
    dateLabel: 'Création',
    hasConditionId: false,
    hasMode: false,
    hasStatus: false,
    hasDateRange: false,
    cadence: 'Événementiel — à l’ouverture et à la clôture de chaque marché',
  },
  post_entry_mid_samples: {
    title: 'Post-entry mid samples',
    description:
      'Échantillons de mid (+1s / +5s / +30s) après un fill ALGO_OPEN pour mesurer l’adverse selection.',
    dateLabel: 'Échantillonnage',
    hasConditionId: true,
    hasMode: false,
    hasStatus: false,
    hasDateRange: true,
    cadence: 'Événementiel — 3 échantillons par fill confirmé',
  },
  market_selections: {
    title: 'Market selections',
    description: 'Sélections de marchés Up/Down suivis par le crypto-algo (auto-track).',
    dateLabel: 'Création',
    hasConditionId: false,
    hasMode: false,
    hasStatus: false,
    hasDateRange: false,
    cadence: 'Ajout/retrait via auto-track ou manuel',
  },
  auto_track_rules: {
    title: 'Auto-track rules',
    description: 'Règles de suivi automatique par paire crypto × intervalle.',
    dateLabel: 'Création',
    hasConditionId: false,
    hasMode: false,
    hasStatus: false,
    hasDateRange: false,
    cadence: 'Configurées par l’opérateur',
  },
  executions: {
    title: 'Exécutions',
    description:
      'Exécutions ALGO_* (entrées/sorties). Lecture seule — partagée avec le copy-trading.',
    dateLabel: 'Exécution',
    hasConditionId: true,
    hasMode: true,
    hasStatus: true,
    hasDateRange: true,
    cadence: 'Événementiel — à chaque ordre algo',
  },
  positions: {
    title: 'Positions',
    description:
      'Positions algo (copied_positions avec reason ALGO_%). Lecture seule — partagée avec le copy-trading.',
    dateLabel: 'Ouverture',
    hasConditionId: true,
    hasMode: true,
    hasStatus: true,
    hasDateRange: true,
    cadence: 'Événementiel — à chaque ouverture/fermeture',
  },
};

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

export function CryptoAlgoDataTab() {
  const [view, setView] = usePersistedEnum<CryptoAlgoDataView>(
    UI_KEYS.cryptoAlgoDataView,
    'grid',
    CRYPTO_ALGO_DATA_VIEWS,
  );
  const [selectedId, setSelectedId] = usePersistedSignal<CryptoAlgoDataTableId | null>(
    UI_KEYS.cryptoAlgoDataTableId,
    null,
    (value): value is CryptoAlgoDataTableId | null =>
      value === null ||
      (typeof value === 'string' &&
        (CRYPTO_ALGO_DATA_TABLE_IDS as readonly string[]).includes(value)),
  );
  const [tables, setTables] = createSignal<CryptoAlgoDataTableSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = createSignal(false);
  const [summaryError, setSummaryError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const [tableDeleting, setTableDeleting] = createSignal(false);

  const [conditionId, setConditionId] = usePersistedSignal(
    UI_KEYS.cryptoAlgoDataConditionId,
    '',
    isPersistedString,
  );
  const [mode, setMode] = usePersistedSignal(
    UI_KEYS.cryptoAlgoDataMode,
    '',
    isPersistedString,
  );
  const [status, setStatus] = usePersistedSignal(
    UI_KEYS.cryptoAlgoDataStatus,
    '',
    isPersistedString,
  );
  const [from, setFrom] = usePersistedSignal(UI_KEYS.cryptoAlgoDataFrom, '', isPersistedString);
  const [to, setTo] = usePersistedSignal(UI_KEYS.cryptoAlgoDataTo, '', isPersistedString);
  const [page, setPage] = usePersistedSignal(UI_KEYS.cryptoAlgoDataPage, 0, isNonNegativeInt);
  const [total, setTotal] = createSignal(0);
  const [rows, setRows] = createSignal<CryptoAlgoDataRow[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);

  async function refreshSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetchCryptoAlgoDataTables();
      setTables(res.tables);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Résumé indisponible');
    }
    setSummaryLoading(false);
  }

  async function loadDetail(pageOverride?: number, tableId?: CryptoAlgoDataTableId) {
    const id = tableId ?? selectedId();
    if (!id) return;
    const pageIndex = pageOverride ?? page();
    setDetailLoading(true);
    setDetailError(null);
    const offset = pageIndex * PAGE_SIZE;
    const base = {
      conditionId: conditionId().trim() || undefined,
      from: from() || undefined,
      to: to() || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    try {
      let result: { items: CryptoAlgoDataRow[]; total: number } = { items: [], total: 0 };
      switch (id) {
        case 'price_ticks':
          result = await fetchCryptoAlgoPriceTicks(base);
          break;
        case 'surveillance_snapshots':
          result = await fetchCryptoAlgoSurveillanceSnapshots({
            limit: base.limit,
            offset: base.offset,
          });
          break;
        case 'post_entry_mid_samples':
          result = await fetchCryptoAlgoPostEntryMidSamples(base);
          break;
        case 'market_selections':
          result = await fetchCryptoAlgoMarketSelections({
            limit: base.limit,
            offset: base.offset,
          });
          break;
        case 'auto_track_rules':
          result = await fetchCryptoAlgoAutoTrackRules({
            limit: base.limit,
            offset: base.offset,
          });
          break;
        case 'executions':
          result = await fetchCryptoAlgoExecutions({
            ...base,
            mode: mode().trim() || undefined,
            status: status().trim() || undefined,
          });
          break;
        case 'positions':
          result = await fetchCryptoAlgoPositions({
            ...base,
            mode: mode().trim() || undefined,
            status: status().trim() || undefined,
          });
          break;
      }
      setRows(result.items);
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

    const restoredView: CryptoAlgoDataView = view();
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
        'Supprimer toutes les données des 5 tables crypto (hors exécutions et positions, en lecture seule) ?\n\n' +
          `${total.toLocaleString()} ligne(s) seront effacées (price ticks, surveillance, mid samples, sélections, règles auto-track).\n` +
          'Cette action est irréversible. Les prochains cycles du crypto-algo pourront réenregistrer des données.',
      )
    ) {
      return;
    }
    setDeleting(true);
    setSummaryError(null);
    try {
      await deleteCryptoAlgoDataTables();
      await refreshSummary();
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Échec de la suppression');
    }
    setDeleting(false);
  }

  async function deleteCurrentTable() {
    const id = selectedId();
    if (!id) return;
    const meta = TABLE_META[id];
    const rowCount = selectedSummary()?.rowCount ?? total();
    if (
      !confirm(
        `Supprimer toutes les données de la table « ${meta.title} » ?\n\n` +
          `${rowCount.toLocaleString()} ligne(s) seront effacées de ${selectedSummary()?.tableName ?? id}.\n` +
          'Cette action est irréversible. Les prochains cycles du crypto-algo pourront réenregistrer des données.',
      )
    ) {
      return;
    }
    setTableDeleting(true);
    setDetailError(null);
    try {
      await deleteCryptoAlgoDataTable(id);
      setPage(0);
      await loadDetail(0);
      await refreshSummary();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Échec de la suppression');
    }
    setTableDeleting(false);
  }

  function openDetail(id: CryptoAlgoDataTableId) {
    setSelectedId(id);
    setConditionId('');
    setMode('');
    setStatus('');
    setFrom('');
    setTo('');
    setPage(0);
    setRows([]);
    setTotal(0);
    setDetailError(null);
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
              title="Supprimer toutes les lignes des 5 tables (hors exécutions/positions)"
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
                    <span class="weather-data-card-cadence-value">{meta.cadence}</span>
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
                      <span>{table.readOnly ? 'Consulter' : 'Ouvrir'}</span>
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
              <div class="weather-data-toolbar-actions">
                <span class="algo-panel-count">{total().toLocaleString()} lignes</span>
                <Show when={!selectedSummary()?.readOnly}>
                  <button
                    type="button"
                    class="btn btn-sm btn-danger"
                    onClick={() => void deleteCurrentTable()}
                    disabled={tableDeleting() || detailLoading() || total() === 0}
                    title={`Supprimer toutes les lignes de la table « ${meta().title} »`}
                  >
                    {tableDeleting() ? 'Suppression…' : 'Supprimer les données'}
                  </button>
                </Show>
              </div>
            </div>

            <form
              class="weather-data-filters"
              onSubmit={(e) => {
                e.preventDefault();
                applyFilters();
              }}
            >
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
              <Show when={meta().hasMode}>
                <label class="weather-data-filter">
                  <span>Mode</span>
                  <input
                    type="text"
                    value={mode()}
                    onInput={(e) => setMode(e.currentTarget.value)}
                    placeholder="sim | real"
                  />
                </label>
              </Show>
              <Show when={meta().hasStatus}>
                <label class="weather-data-filter">
                  <span>Statut</span>
                  <input
                    type="text"
                    value={status()}
                    onInput={(e) => setStatus(e.currentTarget.value)}
                    placeholder="filled | open | closed"
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
              <Pagination
                page={page()}
                pageCount={pageCount()}
                onPage={goToPage}
                disabled={detailLoading()}
                showIfSingle
              />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function DetailHeaders(props: { id: CryptoAlgoDataTableId }) {
  const headers: Record<CryptoAlgoDataTableId, string[]> = {
    price_ticks: [
      'conditionId',
      'UP',
      'DOWN',
      'Spread UP',
      'Spread DOWN',
      'Gap',
      'Sec. fin',
      'Pos. ouvertes',
      'PnL unreal.',
      'Signal',
      'Recorded',
    ],
    surveillance_snapshots: [
      'conditionId',
      'Symbole',
      'Intervalle',
      'Open UP',
      'Open DOWN',
      'Close UP',
      'Close DOWN',
      'Vainqueur',
      'Ouverture',
      'Clôture',
    ],
    post_entry_mid_samples: [
      'conditionId',
      'Outcome',
      'positionId',
      'Offset',
      'UP mid',
      'DOWN mid',
      'Sampled',
    ],
    market_selections: [
      'conditionId',
      'Symbole',
      'Intervalle',
      'Question',
      'Activé',
      'Créé',
    ],
    auto_track_rules: ['Symbole', 'Intervalle', 'Activé', 'Créé'],
    executions: [
      'id',
      'Mode',
      'Side',
      'Statut',
      'Fill price',
      'Fill qty',
      'Slippage %',
      'PnL',
      'Erreur',
      'Exécuté',
    ],
    positions: [
      'id',
      'conditionId',
      'Outcome',
      'Mode',
      'Statut',
      'Qty',
      'Entry',
      'PnL unreal.',
      'PnL réalisé',
      'Ouverture',
      'Fermeture',
    ],
  };
  return (
    <tr>
      <For each={headers[props.id]}>{(h) => <th>{h}</th>}</For>
    </tr>
  );
}

function DetailRow(props: { id: CryptoAlgoDataTableId; row: CryptoAlgoDataRow }) {
  const r = props.row as unknown as Record<string, unknown>;
  const str = (key: string) => {
    const v = r[key];
    if (v == null) return '—';
    return String(v);
  };
  const num = (key: string) => formatNum(r[key] as number | null);
  const ts = (key: string) => formatTs(r[key] as string | null);

  switch (props.id) {
    case 'price_ticks':
      return (
        <tr>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{num('upPrice')}</td>
          <td>{num('downPrice')}</td>
          <td>{num('upSpreadPct')}</td>
          <td>{num('downSpreadPct')}</td>
          <td>{num('priceGap')}</td>
          <td>{str('secondsUntilEnd')}</td>
          <td>{str('openPositionsCount')}</td>
          <td>{num('unrealizedPnl')}</td>
          <td>{str('lastSignalOutcome')}</td>
          <td>{ts('recordedAt')}</td>
        </tr>
      );
    case 'surveillance_snapshots':
      return (
        <tr>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{str('cryptoSymbol')}</td>
          <td>{str('interval')}</td>
          <td>{num('openUpPrice')}</td>
          <td>{num('openDownPrice')}</td>
          <td>{num('closeUpPrice')}</td>
          <td>{num('closeDownPrice')}</td>
          <td>{str('winningOutcome')}</td>
          <td>{ts('openCapturedAt')}</td>
          <td>{ts('closeCapturedAt')}</td>
        </tr>
      );
    case 'post_entry_mid_samples':
      return (
        <tr>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{str('outcome')}</td>
          <td>{str('positionId')}</td>
          <td>{str('offsetMs')} ms</td>
          <td>{num('upMid')}</td>
          <td>{num('downMid')}</td>
          <td>{ts('createdAt')}</td>
        </tr>
      );
    case 'market_selections':
      return (
        <tr>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{str('cryptoSymbol')}</td>
          <td>{str('interval')}</td>
          <td title={str('question')}>{truncate(str('question'), 30)}</td>
          <td>{str('enabled') === 'true' ? 'Oui' : 'Non'}</td>
          <td>{ts('createdAt')}</td>
        </tr>
      );
    case 'auto_track_rules':
      return (
        <tr>
          <td>{str('cryptoSymbol')}</td>
          <td>{str('interval')}</td>
          <td>{str('enabled') === 'true' ? 'Oui' : 'Non'}</td>
          <td>{ts('createdAt')}</td>
        </tr>
      );
    case 'executions':
      return (
        <tr>
          <td>{str('id')}</td>
          <td>{str('mode')}</td>
          <td>{str('side')}</td>
          <td>{str('status')}</td>
          <td>{num('fillPrice')}</td>
          <td>{num('fillQuantity')}</td>
          <td>{num('slippagePercent')}</td>
          <td>{num('realizedPnl')}</td>
          <td title={str('error')}>{truncate(str('error'), 20)}</td>
          <td>{ts('executedAt')}</td>
        </tr>
      );
    case 'positions':
      return (
        <tr>
          <td>{str('id')}</td>
          <td class="text-mono" title={str('conditionId')}>
            {truncate(str('conditionId'))}
          </td>
          <td>{str('outcome')}</td>
          <td>{str('mode')}</td>
          <td>{str('status')}</td>
          <td>{num('quantity')}</td>
          <td>{num('entryPrice')}</td>
          <td>{num('unrealizedPnl')}</td>
          <td>{num('realizedPnl')}</td>
          <td>{ts('openedAt')}</td>
          <td>{ts('closedAt')}</td>
        </tr>
      );
  }
}
