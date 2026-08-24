import { createSignal, onCleanup, onMount } from 'solid-js';
import { debounceFn } from '../lib/debounce';
import {
  buildConfigDiffPreviewLines,
  type ConfigDiffPreviewLine,
  type SnapshotConfigMode,
} from '../lib/snapshot-config-diff';
import { connectSocket } from '../socket';
import type { SimAlgoKind } from '../lib/simulation';

export const SNAPSHOT_PAGE_SIZE = 12;
export const SNAPSHOT_CHART_LIMIT = 200;
export const SESSION_PAGE_SIZE = 12;

export type SnapshotPanelView = 'sessions' | 'snapshots';

const LABEL_DEBOUNCE_MS = 400;

/**
 * Types de base des éléments de snapshot/session consommés par les panels.
 * Les types Sim/Real des libs en sont des supersets structurels (vérifié) :
 * ce hook central travaille sur ces shapes, et chaque wrapper fait le cast
 * vers les types concrets des libs (SimStateSnapshotSummary, RealSessionSummary...).
 */
export interface SnapshotStateShape {
  id: number;
  createdAt: string;
  label: string | null;
  source: string;
  sessionId?: number | null;
  amount: number;
  token: string;
  equity: number;
  sessionPnl: number;
  positionCount: number;
  traderCount: number;
}
export interface SessionShape {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: string;
  label: string | null;
  baselineCapital: number;
  snapshotCount: number;
  sessionPnl: number | null;
  archiveSummary: unknown | null;
  config?: unknown;
}
export interface DetailShape {
  id: number;
  equity: number;
  token: string;
  sessionPnl: number;
  traderCount: number;
  config?: unknown;
}

export interface SnapshotFiltersShape {
  source?: string;
  sessionId?: number;
  label?: string;
  from?: string;
  to?: string;
  algoKind?: SimAlgoKind;
}
export interface SessionFiltersShape {
  status?: string;
  label?: string;
  algoKind?: SimAlgoKind;
}

/** Adaptateur par mode : isole les différences sim/real. */
export interface SnapshotsBackend {
  configDiffMode: SnapshotConfigMode;
  refreshEvents: string[];
  labels: { session: string; sessions: string };
  supportsAlgoKind: boolean;

  fetchSessions: (
    limit: number,
    offset: number,
    filters: SessionFiltersShape,
  ) => Promise<{ items: SessionShape[]; total: number }>;
  fetchCurrentSession: (algoKind: SimAlgoKind | undefined) => Promise<SessionShape | null>;
  updateSession: (id: number, patch: { label?: string | null }) => Promise<SessionShape>;
  deleteSession: (id: number, algoKind: SimAlgoKind | undefined, deleteSnapshots: boolean) => Promise<unknown>;
  deleteAllClosedSessions: (algoKind: SimAlgoKind | undefined) => Promise<unknown>;

  fetchSnapshots: (
    limit: number,
    offset: number,
    filters: SnapshotFiltersShape,
  ) => Promise<{ items: SnapshotStateShape[]; total: number }>;
  fetchSnapshotDetail: (id: number) => Promise<DetailShape>;
  deleteAllSnapshots: (algoKind: SimAlgoKind | undefined) => Promise<unknown>;
}

export interface UseSnapshotsOptions {
  initialAlgoKind?: SimAlgoKind;
  initialSnapshotFilters?: SnapshotFiltersShape;
  initialSessionFilters?: SessionFiltersShape;
}

/** API du hook, paramétrée par les types concrets (libs sim/real). */
export interface UseSnapshotsApi<
  TState,
  TSession,
  TDetail,
  TSnapshotFilter extends SnapshotFiltersShape = SnapshotFiltersShape,
  TSessionFilter extends SessionFiltersShape = SessionFiltersShape,
> {
  view: () => SnapshotPanelView;
  algoKind: () => SimAlgoKind;
  setAlgoKind: (kind: SimAlgoKind) => void;
  switchView: (next: SnapshotPanelView) => void;
  items: () => TState[];
  chartItems: () => TState[];
  total: () => number;
  page: () => number;
  pageCount: () => number;
  filters: () => TSnapshotFilter;
  sessions: () => TSession[];
  sessionsTotal: () => number;
  sessionsPage: () => number;
  sessionsPageCount: () => number;
  sessionFilters: () => TSessionFilter;
  currentSession: () => TSession | null;
  focusedSession: () => TSession | null;
  selected: () => Set<number>;
  referenceId: () => number | null;
  setReferenceId: (v: number | null) => void;
  selectedSessions: () => Set<number>;
  selectedSessionSummaries: () => TSession[];
  sessionReferenceId: () => number | null;
  setSessionReferenceId: (v: number | null) => void;
  sessionConfigDiffPreview: (
    sessionId: number,
  ) => { loading: boolean; error: boolean; lines: ConfigDiffPreviewLine[] } | null;
  details: () => Map<number, TDetail>;
  loading: () => boolean;
  deleting: () => boolean;
  selectedSummaries: () => TState[];
  referenceSnapshot: () => TState | undefined;
  latestSnapshot: () => TState | null;
  latestEquityDelta: () => number | null;
  loadList: () => Promise<void>;
  loadSessions: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleSelected: (id: number) => void;
  toggleSessionSelected: (id: number) => void;
  clearSessionSelection: () => void;
  setSourceFilter: (source: string | undefined) => void;
  setLabelFilter: (label: string) => void;
  setDateFilter: (field: 'from' | 'to', value: string) => void;
  clearFilters: () => void;
  openSessionSnapshots: (sessionId: number) => void;
  clearSessionFocus: () => void;
  setSessionStatusFilter: (status: string | undefined) => void;
  setSessionLabelFilter: (label: string) => void;
  clearSessionFilters: () => void;
  goToPage: (next: number) => Promise<void>;
  goToSessionsPage: (next: number) => Promise<void>;
  loadDetailsForSelected: (ids: number[]) => Promise<void>;
  renameSession: (id: number, label: string | null) => Promise<TSession>;
  removeSession: (id: number, deleteSnapshots: boolean) => Promise<unknown>;
  deleteSelectedSessions: () => Promise<void>;
  deleteAll: () => Promise<boolean>;
  deleteAllClosedSessions: () => Promise<boolean>;
}

export function useSnapshots(backend: SnapshotsBackend, options: UseSnapshotsOptions = {}) {
  const initialAlgo = options.initialAlgoKind ?? 'crypto';
  const [algoKind, setAlgoKind] = createSignal<SimAlgoKind>(initialAlgo);
  const [view, setView] = createSignal<SnapshotPanelView>('sessions');
  const [items, setItems] = createSignal<SnapshotStateShape[]>([]);
  const [chartItems, setChartItems] = createSignal<SnapshotStateShape[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const [filters, setFilters] = createSignal<SnapshotFiltersShape>(options.initialSnapshotFilters ?? { source: 'all' });
  const [sessions, setSessions] = createSignal<SessionShape[]>([]);
  const [sessionsTotal, setSessionsTotal] = createSignal(0);
  const [sessionsPage, setSessionsPage] = createSignal(0);
  const [sessionFilters, setSessionFilters] = createSignal<SessionFiltersShape>(options.initialSessionFilters ?? { status: 'all' });
  const [currentSession, setCurrentSession] = createSignal<SessionShape | null>(null);
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [selectedItems, setSelectedItems] = createSignal<Map<number, SnapshotStateShape>>(new Map());
  const [selectedSessions, setSelectedSessions] = createSignal<Set<number>>(new Set());
  const [selectedSessionItems, setSelectedSessionItems] = createSignal<Map<number, SessionShape>>(new Map());
  const [sessionReferenceId, setSessionReferenceId] = createSignal<number | null>(null);
  const [referenceId, setReferenceId] = createSignal<number | null>(null);
  const [details, setDetails] = createSignal<Map<number, DetailShape>>(new Map());
  const [sessionConfigs, setSessionConfigs] = createSignal<Map<number, Record<string, unknown>>>(new Map());
  const [sessionConfigsLoading, setSessionConfigsLoading] = createSignal(false);
  const [sessionConfigsError, setSessionConfigsError] = createSignal(false);
  let configLoadGen = 0;
  const [loading, setLoading] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const pageCount = () => Math.max(1, Math.ceil(total() / SNAPSHOT_PAGE_SIZE));
  const sessionsPageCount = () => Math.max(1, Math.ceil(sessionsTotal() / SESSION_PAGE_SIZE));

  const selectedSummaries = () =>
    [...selectedItems().values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const selectedSessionSummaries = () =>
    [...selectedSessionItems().values()].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

  const focusedSession = () => {
    const id = filters().sessionId;
    if (id == null) return null;
    return sessions().find((s) => s.id === id) ?? (currentSession()?.id === id ? currentSession() : null);
  };

  function clearSelection() {
    setSelected(new Set<number>());
    setSelectedItems(new Map());
    setReferenceId(null);
  }

  function clearSessionSelection() {
    setSelectedSessions(new Set<number>());
    setSelectedSessionItems(new Map());
    setSessionReferenceId(null);
    setSessionConfigs(new Map());
    setSessionConfigsLoading(false);
    setSessionConfigsError(false);
  }

  async function loadConfigsForSelectedSessions(ids: number[]) {
    const gen = ++configLoadGen;
    if (ids.length < 2) {
      setSessionConfigs(new Map());
      setSessionConfigsLoading(false);
      setSessionConfigsError(false);
      return;
    }
    setSessionConfigsLoading(true);
    setSessionConfigsError(false);
    try {
      const next = new Map(sessionConfigs());
      for (const key of [...next.keys()]) {
        if (!ids.includes(key)) next.delete(key);
      }
      const selected = selectedSessionSummaries();
      for (const session of selected) {
        if (session.config) {
          next.set(session.id, session.config as Record<string, unknown>);
        }
      }
      if (gen !== configLoadGen) return;
      setSessionConfigs(new Map(next));
    } catch {
      if (gen !== configLoadGen) return;
      setSessionConfigs(new Map());
      setSessionConfigsError(true);
    } finally {
      if (gen === configLoadGen) setSessionConfigsLoading(false);
    }
  }

  const sessionConfigDiffPreview = (
    sessionId: number,
  ): { loading: boolean; error: boolean; lines: ConfigDiffPreviewLine[] } | null => {
    const selected = selectedSessionSummaries();
    if (selected.length < 2 || !selectedSessions().has(sessionId)) return null;
    if (sessionConfigsLoading()) return { loading: true, error: false, lines: [] };
    if (sessionConfigsError()) return { loading: false, error: true, lines: [] };
    const configs = sessionConfigs();
    if (!selected.every((s) => configs.has(s.id))) {
      return { loading: true, error: false, lines: [] };
    }
    const refId = sessionReferenceId() ?? selected[0]!.id;
    const inputs = selected.map((s) => ({ snapshotId: s.id, config: configs.get(s.id) }));
    return {
      loading: false,
      error: false,
      lines: buildConfigDiffPreviewLines(backend.configDiffMode, inputs, sessionId, refId),
    };
  };

  function mergeSelectedSummaries(pageItems: SnapshotStateShape[]) {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      for (const item of pageItems) {
        if (selected().has(item.id)) next.set(item.id, item);
      }
      return next;
    });
  }

  function mergeSelectedSessions(pageItems: SessionShape[]) {
    setSelectedSessionItems((prev) => {
      const next = new Map(prev);
      for (const item of pageItems) {
        if (selectedSessions().has(item.id)) next.set(item.id, item);
      }
      return next;
    });
  }

  const referenceSnapshot = () => {
    const id = referenceId();
    if (id == null) return selectedSummaries()[0];
    return selectedSummaries().find((s) => s.id === id) ?? selectedSummaries()[0];
  };

  const latestSnapshot = () => items()[0] ?? null;
  const previousSnapshot = () => items()[1] ?? null;

  const latestEquityDelta = () => {
    const latest = latestSnapshot();
    const prev = previousSnapshot();
    if (!latest || !prev) return null;
    return latest.equity - prev.equity;
  };

  async function loadCurrentSession() {
    try {
      setCurrentSession(await backend.fetchCurrentSession(backend.supportsAlgoKind ? algoKind() : undefined));
    } catch {
      setCurrentSession(null);
    }
  }

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await backend.fetchSessions(
        SESSION_PAGE_SIZE,
        sessionsPage() * SESSION_PAGE_SIZE,
        sessionFilters(),
      );
      setSessions(data.items);
      setSessionsTotal(data.total);
      mergeSelectedSessions(data.items);
      await loadCurrentSession();
    } finally {
      setLoading(false);
    }
  }

  async function loadChartSeries() {
    try {
      const data = await backend.fetchSnapshots(SNAPSHOT_CHART_LIMIT, 0, filters());
      setChartItems(data.items);
    } catch {
      setChartItems([]);
    }
  }

  async function loadList() {
    setLoading(true);
    try {
      const data = await backend.fetchSnapshots(
        SNAPSHOT_PAGE_SIZE,
        page() * SNAPSHOT_PAGE_SIZE,
        filters(),
      );
      setItems(data.items);
      setTotal(data.total);
      mergeSelectedSummaries(data.items);
      await loadChartSeries();
      await loadCurrentSession();
    } finally {
      setLoading(false);
    }
  }

  function changeAlgoKind(kind: SimAlgoKind) {
    if (kind === algoKind()) return;
    setAlgoKind(kind);
    setSessionFilters((f) => ({ ...f, algoKind: kind }));
    clearSelection();
    clearSessionSelection();
    setPage(0);
    setSessionsPage(0);
    if (filters().sessionId != null) setFilters({ source: 'all' });
  }

  async function refresh() {
    if (view() === 'sessions') {
      await loadSessions();
    } else {
      await loadList();
    }
  }

  async function loadDetailsForSelected(ids: number[]) {
    const map = new Map(details());
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length === 0) return;
    const fetched = await Promise.all(
      missing.map(async (id) => {
        const detail = await backend.fetchSnapshotDetail(id);
        return [id, detail] as const;
      }),
    );
    for (const [id, detail] of fetched) {
      map.set(id, detail);
    }
    setDetails(map);
  }

  function syncReferenceAfterSelection(next: Set<number>, summaries: SnapshotStateShape[]) {
    const ref = referenceId();
    if (ref != null && next.has(ref)) return;
    setReferenceId(summaries[0]?.id ?? null);
  }

  function toggleSelected(id: number) {
    const row = items().find((s) => s.id === id);
    const next = new Set(selected());
    const nextItems = new Map(selectedItems());
    if (next.has(id)) {
      next.delete(id);
      nextItems.delete(id);
    } else {
      next.add(id);
      if (row) nextItems.set(id, row);
    }
    setSelected(next);
    setSelectedItems(nextItems);
    syncReferenceAfterSelection(next, [...nextItems.values()]);
    void loadDetailsForSelected([...next]);
  }

  function syncSessionReferenceAfterSelection(next: Set<number>, summaries: SessionShape[]) {
    const ref = sessionReferenceId();
    if (ref != null && next.has(ref)) return;
    setSessionReferenceId(summaries[0]?.id ?? null);
  }

  function toggleSessionSelected(id: number) {
    const row = sessions().find((s) => s.id === id) ?? (currentSession()?.id === id ? currentSession() : null);
    const next = new Set(selectedSessions());
    const nextItems = new Map(selectedSessionItems());
    if (next.has(id)) {
      next.delete(id);
      nextItems.delete(id);
    } else {
      next.add(id);
      if (row) nextItems.set(id, row);
    }
    setSelectedSessions(next);
    setSelectedSessionItems(nextItems);
    syncSessionReferenceAfterSelection(next, [...nextItems.values()]);
    void loadConfigsForSelectedSessions([...next]);
  }

  function applyFiltersChange() {
    clearSelection();
    setPage(0);
    void loadList();
  }

  function setSourceFilter(source: string) {
    setFilters((f) => ({ ...f, source }));
    applyFiltersChange();
  }

  function setDateFilter(field: 'from' | 'to', value: string) {
    setFilters((f) => ({ ...f, [field]: value || undefined }));
    applyFiltersChange();
  }

  const debouncedLabelLoad = debounceFn(() => {
    applyFiltersChange();
  }, LABEL_DEBOUNCE_MS);

  function setLabelFilter(label: string) {
    setFilters((f) => ({ ...f, label }));
    debouncedLabelLoad();
  }

  function clearFilters() {
    setFilters({ source: 'all', sessionId: filters().sessionId });
    applyFiltersChange();
  }

  function openSessionSnapshots(sessionId: number) {
    clearSelection();
    setFilters({ source: 'all', sessionId });
    setPage(0);
    setView('snapshots');
    void loadList();
  }

  function clearSessionFocus() {
    setFilters((f) => {
      const next = { ...f };
      delete next.sessionId;
      return next;
    });
    applyFiltersChange();
  }

  function switchView(next: SnapshotPanelView) {
    setView(next);
    if (next === 'sessions') void loadSessions();
    else void loadList();
  }

  function applySessionFiltersChange() {
    clearSessionSelection();
    setSessionsPage(0);
    void loadSessions();
  }

  function setSessionStatusFilter(status: string) {
    setSessionFilters((f) => ({ ...f, status }));
    applySessionFiltersChange();
  }

  const debouncedSessionLabel = debounceFn(() => {
    applySessionFiltersChange();
  }, LABEL_DEBOUNCE_MS);

  function setSessionLabelFilter(label: string) {
    setSessionFilters((f) => ({ ...f, label }));
    debouncedSessionLabel();
  }

  function clearSessionFilters() {
    setSessionFilters({ status: 'all' });
    applySessionFiltersChange();
  }

  async function goToPage(nextPage: number) {
    const clamped = Math.max(0, Math.min(nextPage, pageCount() - 1));
    setPage(clamped);
    await loadList();
  }

  async function goToSessionsPage(nextPage: number) {
    const clamped = Math.max(0, Math.min(nextPage, sessionsPageCount() - 1));
    setSessionsPage(clamped);
    await loadSessions();
  }

  async function renameSession(id: number, label: string | null) {
    const updated = await backend.updateSession(id, { label });
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    if (currentSession()?.id === id) setCurrentSession(updated);
    setSelectedSessionItems((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, updated);
      return next;
    });
    return updated;
  }

  async function removeSession(id: number, deleteSnapshots: boolean) {
    const result = await backend.deleteSession(id, backend.supportsAlgoKind ? algoKind() : undefined, deleteSnapshots);
    if (filters().sessionId === id) clearSessionFocus();
    setSelectedSessions((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedSessionItems((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    if (sessionReferenceId() === id) setSessionReferenceId(null);
    await refresh();
    return result;
  }

  async function deleteSelectedSessions() {
    const ids = [...selectedSessions()];
    if (ids.length === 0) return;
    const totalSnapshots = ids.reduce(
      (sum, id) => sum + (selectedSessionItems().get(id)?.snapshotCount ?? 0),
      0,
    );
    const deleteSnapshots =
      totalSnapshots > 0
        ? confirm(
            `${ids.length} ${backend.labels.sessions} — ${totalSnapshots} snapshot(s).\n\nOK = supprimer ${backend.labels.sessions} + snapshots\nAnnuler = supprimer seulement les ${backend.labels.sessions}`,
          )
        : false;
    if (
      !confirm(
        deleteSnapshots
          ? `Confirmer la suppression de ${ids.length} ${backend.labels.sessions} et de leurs snapshots ?`
          : `Supprimer ${ids.length} ${backend.labels.sessions} ?`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await Promise.all(
        ids.map((id) => backend.deleteSession(id, backend.supportsAlgoKind ? algoKind() : undefined, deleteSnapshots)),
      );
      clearSessionSelection();
      await refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function deleteAll() {
    const count = total();
    if (count === 0 && view() === 'snapshots') return false;
    const confirmed = confirm(
      view() === 'snapshots'
        ? `Supprimer tous les snapshots (${count}) ?\n\nCette action est irréversible.`
        : `Supprimer tous les snapshots ?\n\nLes ${backend.labels.sessions} fermé${backend.labels.session === 'session' ? 'es' : 'es'} resteront (sans snapshots).`,
    );
    if (!confirmed) return false;
    setDeleting(true);
    try {
      await backend.deleteAllSnapshots(backend.supportsAlgoKind ? algoKind() : undefined);
      clearSelection();
      setDetails(new Map());
      setPage(0);
      await refresh();
      return true;
    } finally {
      setDeleting(false);
    }
  }

  async function deleteAllClosedSessions() {
    const confirmed = confirm(
      `Supprimer toutes les ${backend.labels.sessions} fermées et leurs snapshots ?\n\nCette action est irréversible.`,
    );
    if (!confirmed) return false;
    setDeleting(true);
    try {
      await backend.deleteAllClosedSessions(backend.supportsAlgoKind ? algoKind() : undefined);
      clearSelection();
      clearSessionSelection();
      setDetails(new Map());
      setPage(0);
      setSessionsPage(0);
      await refresh();
      return true;
    } finally {
      setDeleting(false);
    }
  }

  onMount(() => {
    void refresh();
    const socket = connectSocket();
    const onRefresh = () => void refresh();
    for (const evt of backend.refreshEvents) {
      socket.on(evt, onRefresh);
    }
    onCleanup(() => {
      for (const evt of backend.refreshEvents) {
        socket.off(evt, onRefresh);
      }
      debouncedLabelLoad.cancel();
      debouncedSessionLabel.cancel();
    });
  });

  return {
    view,
    algoKind,
    setAlgoKind: backend.supportsAlgoKind ? changeAlgoKind : () => {},
    switchView,
    items,
    chartItems,
    total,
    page,
    pageCount,
    filters,
    sessions,
    sessionsTotal,
    sessionsPage,
    sessionsPageCount,
    sessionFilters,
    currentSession,
    focusedSession,
    selected,
    referenceId,
    setReferenceId,
    selectedSessions,
    selectedSessionSummaries,
    sessionReferenceId,
    setSessionReferenceId,
    sessionConfigDiffPreview,
    details,
    loading,
    deleting,
    selectedSummaries,
    referenceSnapshot,
    latestSnapshot,
    latestEquityDelta,
    loadList,
    loadSessions,
    refresh,
    toggleSelected,
    toggleSessionSelected,
    clearSessionSelection,
    setSourceFilter,
    setLabelFilter,
    setDateFilter,
    clearFilters,
    openSessionSnapshots,
    clearSessionFocus,
    setSessionStatusFilter,
    setSessionLabelFilter,
    clearSessionFilters,
    goToPage,
    goToSessionsPage,
    loadDetailsForSelected,
    renameSession,
    removeSession,
    deleteSelectedSessions,
    deleteAll,
    deleteAllClosedSessions,
  };
}
