import { createSignal, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import type { SimAlgoKind } from '../../lib/simulation';
import { formatPnlAmount, pnlClass } from '../../lib/position';
import { formatShortDateTime } from '../../lib/date';
import { SessionElapsed } from '../SessionElapsed';
import { CollapsiblePanel, useCollapse } from '../CollapsiblePanel';
import { Icon } from '../Icon';
import { SimSessionCard } from '../SimSessionCard';
import { SimSessionComparePanel } from '../SimSessionComparePanel';
import { SimSnapshotCard } from '../SimSnapshotCard';
import { SimSnapshotComparePanel } from '../SimSnapshotComparePanel';
import { SimSnapshotDetailDialog } from '../dialogs/SimSnapshotDetailDialog';
import { SimSnapshotEquityChart } from '../charts/SimSnapshotEquityChart';
import { SimSnapshotFilters } from '../SimSnapshotFilters';
import type { UseSnapshotsApi } from '../../hooks/useSnapshots';
import type { SimSessionSummary } from '../../lib/simulation-sessions';
import type { SimStateSnapshotDetail, SimStateSnapshotSummary } from '../../lib/simulation-snapshots';

interface SnapshotsPanelProps {
  snap: UseSnapshotsApi<
    SimStateSnapshotSummary,
    SimSessionSummary,
    SimStateSnapshotDetail
  >;
  /** Titre du panneau. */
  title: string;
  /** Libellé singulier ("session" ou "période"). */
  noun: string;
  /** Libellé pluriel ("sessions" ou "périodes"). */
  nouns: string;
  /** Onglets algo (sim uniquement — vide/undefined pour real). */
  algoTabs?: { id: SimAlgoKind; label: string }[];
  /** Texte de l'état vide des sessions. */
  sessionsEmptyHint: string;
  /** Mode de diff de config pour SimSnapshotComparePanel. */
  compareConfigMode: 'sim' | 'real';
  /** Dialogue de création (Sim vs Real). */
  renderCreateDialog: (state: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    algoKind: SimAlgoKind;
  }) => JSX.Element;
  /** Dialogue de configuration (Sim vs Real). */
  renderSettingsDialog: (state: { open: boolean; onClose: () => void }) => JSX.Element;
  /** Dialogue d'archive (Sim vs Real). */
  renderArchiveDialog: (state: {
    open: boolean;
    session: SimSessionSummary | null;
    onClose: () => void;
  }) => JSX.Element;
}

/**
 * Panneau d'exploration des snapshots/sessions, commun aux modes sim et real.
 * Toutes les divergences (libellés, onglets algo, dialogues) sont injectées via
 * props. Le hook est fourni typé Sim (le panneau real cast ses données en types
 * Sim — pattern historique déjà utilisé).
 */
export function SnapshotsPanel(props: SnapshotsPanelProps) {
  const snap = props.snap;
  const [collapsed, setCollapsed] = useCollapse();
  const [detailId, setDetailId] = createSignal<number | null>(null);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [archiveSession, setArchiveSession] = createSignal<SimSessionSummary | null>(null);
  const [archiveOpen, setArchiveOpen] = createSignal(false);

  const activeDetail = () => {
    const id = detailId();
    if (id == null) return null;
    return snap.details().get(id) ?? null;
  };

  function openDetail(id: number) {
    setDetailId(id);
    setDetailOpen(true);
    void snap.loadDetailsForSelected([id]);
  }

  function paginationLabel(): string {
    return `Page ${snap.page() + 1} / ${snap.pageCount()}`;
  }

  function sessionsPaginationLabel(): string {
    return `Page ${snap.sessionsPage() + 1} / ${snap.sessionsPageCount()}`;
  }

  function renameSession(id: number, current: string | null) {
    const next = prompt(`Nom de la ${props.noun}`, current ?? '');
    if (next == null) return;
    const label = next.trim() || null;
    void snap.renameSession(id, label);
  }

  function openArchive(session: SimSessionSummary) {
    setArchiveSession(session);
    setArchiveOpen(true);
  }

  function deleteSession(id: number, snapshotCount: number) {
    const deleteSnapshots =
      snapshotCount > 0
        ? confirm(
            `${props.noun} #${id} — ${snapshotCount} snapshot(s).\n\nOK = supprimer ${props.noun} + snapshots\nAnnuler = supprimer seulement la ${props.noun}`,
          )
        : false;
    if (
      !confirm(
        deleteSnapshots
          ? `Confirmer la suppression de la ${props.noun} #${id} et de ses snapshots ?`
          : `Supprimer la ${props.noun} #${id} ?`,
      )
    ) {
      return;
    }
    void snap.removeSession(id, deleteSnapshots);
  }

  const headerCount = () =>
    snap.view() === 'sessions'
      ? `${snap.sessionsTotal()} ${props.noun}${snap.sessionsTotal() !== 1 ? 's' : ''}`
      : `${snap.total()} snapshot${snap.total() !== 1 ? 's' : ''}`;

  return (
    <>
      <section class="panel">
        <div class="panel-header">
          <h2>{props.title}</h2>
          {props.algoTabs ? (
            <nav class="algo-kind-tabs" role="tablist" aria-label="Algo kind">
              <For each={props.algoTabs}>
                {(tab) => (
                  <button
                    type="button"
                    class="algo-kind-tab"
                    classList={{ active: snap.algoKind() === tab.id }}
                    role="tab"
                    aria-selected={snap.algoKind() === tab.id}
                    onClick={() => {
                      snap.setAlgoKind(tab.id);
                      void snap.refresh();
                    }}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </nav>
          ) : null}
          <div class="event-header-actions">
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>
              Nouveau snapshot
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setSettingsOpen(true)}>
              Configurer
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAll()}
            >
              {snap.deleting() ? 'Suppression…' : 'Supprimer tous'}
            </button>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              disabled={snap.deleting()}
              onClick={() => void snap.deleteAllClosedSessions()}
              title={`Supprimer toutes les ${props.nouns} fermées et leurs snapshots`}
            >
              {snap.deleting() ? 'Suppression…' : `Suppr. ${props.nouns} archivées`}
            </button>
            <span class="panel-count">{headerCount()}</span>
            <button
              class="panel-collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed() ? 'Déplier' : 'Plier'}
            >
              <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
            </button>
          </div>
        </div>

        <CollapsiblePanel collapsed={collapsed()}>
          <Show
            when={!snap.loading() || snap.sessions().length > 0 || snap.items().length > 0}
            fallback={<div class="empty-state">Chargement…</div>}
          >
            <div class="panel-body sim-snapshot-panel">
              <div class="panel-tabs sim-snapshot-view-tabs">
                <button
                  type="button"
                  class={`panel-tab ${snap.view() === 'sessions' ? 'active' : ''}`}
                  onClick={() => snap.switchView('sessions')}
                >
                  {props.nouns}
                </button>
                <button
                  type="button"
                  class={`panel-tab ${snap.view() === 'snapshots' ? 'active' : ''}`}
                  onClick={() => snap.switchView('snapshots')}
                >
                  Snapshots
                </button>
              </div>

              <Show when={snap.currentSession()}>
                {(current) => (
                  <section class="sim-snapshot-summary mode-hero">
                    <div class="mode-hero-group">
                      <div class="mode-hero-stat">
                        <span class="mode-hero-label">{props.noun} en cours</span>
                        <span class="mode-hero-value">
                          {current().label?.trim() || `#${current().id}`}
                        </span>
                        <span class="mode-hero-meta">
                          depuis {formatShortDateTime(current().startedAt)} ·{' '}
                          <SessionElapsed
                            startedAt={current().startedAt}
                            endedAt={current().endedAt}
                            live
                          />
                        </span>
                      </div>
                      <div class="mode-hero-divider" aria-hidden="true" />
                      <div class="mode-hero-stat">
                        <span class="mode-hero-label">PnL {props.noun}</span>
                        <span class={`mode-hero-value mono ${pnlClass(current().sessionPnl ?? 0)}`}>
                          {formatPnlAmount(current().sessionPnl ?? 0, true)}
                        </span>
                        <span class="mode-hero-meta mono">
                          {current().snapshotCount} snapshot
                          {current().snapshotCount !== 1 ? 's' : ''} · baseline{' '}
                          {formatPnlAmount(current().baselineCapital)}
                        </span>
                      </div>
                      <div class="mode-hero-divider" aria-hidden="true" />
                      <div class="mode-hero-stat">
                        <span class="mode-hero-label">Actions</span>
                        <span class="mode-hero-meta sim-session-hero-actions">
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            onClick={() => snap.openSessionSnapshots(current().id)}
                          >
                            Voir ses snapshots
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-sm"
                            onClick={() => renameSession(current().id, current().label)}
                          >
                            Renommer
                          </button>
                        </span>
                      </div>
                    </div>
                  </section>
                )}
              </Show>

              <Show when={snap.view() === 'sessions'}>
                <div class="sim-snapshot-filters">
                  <label class="sim-snapshot-filter">
                    <span class="sim-snapshot-filter-label">Statut</span>
                    <select
                      class="input input-sm"
                      value={snap.sessionFilters().status ?? 'all'}
                      onChange={(e) =>
                        snap.setSessionStatusFilter(e.currentTarget.value as 'all' | 'active' | 'closed')
                      }
                    >
                      <option value="all">Toutes</option>
                      <option value="active">Actives</option>
                      <option value="closed">Fermées</option>
                    </select>
                  </label>
                  <label class="sim-snapshot-filter sim-snapshot-filter-grow">
                    <span class="sim-snapshot-filter-label">Label</span>
                    <input
                      class="input input-sm"
                      type="search"
                      placeholder="Rechercher…"
                      value={snap.sessionFilters().label ?? ''}
                      onInput={(e) => snap.setSessionLabelFilter(e.currentTarget.value)}
                    />
                  </label>
                  <Show
                    when={
                      (snap.sessionFilters().status && snap.sessionFilters().status !== 'all') ||
                      Boolean(snap.sessionFilters().label?.trim())
                    }
                  >
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm sim-snapshot-filter-clear"
                      onClick={() => snap.clearSessionFilters()}
                    >
                      Effacer filtres
                    </button>
                  </Show>
                </div>

                <Show
                  when={snap.sessionsTotal() > 0}
                  fallback={
                    <div class="empty-state sim-snapshot-empty">
                      <div class="empty-state-icon">◈</div>
                      <p>Aucune {props.noun} pour l’instant.</p>
                      <p class="form-hint">{props.sessionsEmptyHint}</p>
                    </div>
                  }
                >
                  <div class="sim-snapshot-list-header">
                    <p class="form-hint sim-snapshot-hint">
                      Cochez des {props.nouns} pour les comparer. Une {props.noun}
                      regroupe tous les snapshots entre deux clôtures.
                      {snap.selectedSessions().size > 0
                        ? ` · ${snap.selectedSessions().size} sélectionnée${snap.selectedSessions().size > 1 ? 's' : ''}`
                        : ''}
                    </p>
                    <div class="sim-snapshot-list-header-actions">
                      <Show when={snap.selectedSessions().size > 0}>
                        <button
                          type="button"
                          class="btn btn-danger btn-sm"
                          onClick={() => void snap.deleteSelectedSessions()}
                        >
                          Supprimer la sélection
                        </button>
                      </Show>
                      <div class="event-pagination">
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm"
                          disabled={snap.sessionsPage() === 0}
                          onClick={() => void snap.goToSessionsPage(snap.sessionsPage() - 1)}
                        >
                          Précédent
                        </button>
                        <span class="event-pagination-info">{sessionsPaginationLabel()}</span>
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm"
                          disabled={snap.sessionsPage() >= snap.sessionsPageCount() - 1}
                          onClick={() => void snap.goToSessionsPage(snap.sessionsPage() + 1)}
                        >
                          Suivant
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="sim-session-cards">
                    <For each={snap.sessions()}>
                      {(row) => (
                        <SimSessionCard
                          session={row}
                          selected={snap.selectedSessions().has(row.id)}
                          onToggle={() => snap.toggleSessionSelected(row.id)}
                          onOpen={() => snap.openSessionSnapshots(row.id)}
                          onRename={() => renameSession(row.id, row.label)}
                          configDiffPreview={snap.sessionConfigDiffPreview(row.id)}
                          onArchive={
                            row.status === 'closed' && row.archiveSummary
                              ? () => openArchive(row)
                              : undefined
                          }
                          onDelete={
                            row.status === 'closed'
                              ? () => deleteSession(row.id, row.snapshotCount)
                              : undefined
                          }
                        />
                      )}
                    </For>
                  </div>

                  <Show when={snap.selectedSessionSummaries().length > 0}>
                    <SimSessionComparePanel
                      selected={snap.selectedSessionSummaries()}
                      referenceId={snap.sessionReferenceId()}
                      onReferenceChange={snap.setSessionReferenceId}
                      onClear={snap.clearSessionSelection}
                    />
                  </Show>
                </Show>
              </Show>

              <Show when={snap.view() === 'snapshots'}>
                <Show when={snap.filters().sessionId != null}>
                  <div class="sim-session-focus-bar">
                    <span>
                      Filtré sur{' '}
                      <strong>
                        {snap.focusedSession()?.label?.trim() ||
                          `${props.noun} #${snap.filters().sessionId}`}
                      </strong>
                    </span>
                    <button type="button" class="btn btn-ghost btn-sm" onClick={() => snap.clearSessionFocus()}>
                      Voir tous les snapshots
                    </button>
                  </div>
                </Show>

                <SimSnapshotFilters
                  filters={snap.filters()}
                  onSourceChange={snap.setSourceFilter}
                  onLabelChange={snap.setLabelFilter}
                  onFromChange={(from) => snap.setDateFilter('from', from)}
                  onToChange={(to) => snap.setDateFilter('to', to)}
                  onClear={snap.clearFilters}
                />

                <Show
                  when={snap.total() > 0}
                  fallback={
                    <div class="empty-state sim-snapshot-empty">
                      <div class="empty-state-icon">◈</div>
                      <p>Aucun snapshot ne correspond aux filtres.</p>
                      <p class="form-hint">Créez un snapshot ou ajustez les filtres.</p>
                      <button type="button" class="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                        Créer un snapshot
                      </button>
                    </div>
                  }
                >
                  <Show when={snap.latestSnapshot()}>
                    {(latest) => (
                      <section class="sim-snapshot-summary mode-hero sim-snapshot-summary-secondary">
                        <div class="mode-hero-group">
                          <div class="mode-hero-stat">
                            <span class="mode-hero-label">Dernier (page)</span>
                            <span class="mode-hero-value mono">
                              {formatPnlAmount(latest().equity)}
                              <span class="mode-hero-token">{latest().token}</span>
                            </span>
                            <span class="mode-hero-meta">
                              {formatShortDateTime(latest().createdAt)}
                              {latest().label ? ` · ${latest().label}` : ''}
                              <Show when={snap.latestEquityDelta() != null}>
                                <span class={pnlClass(snap.latestEquityDelta()!)}>
                                  {' '}· Δ equity{' '}
                                  {formatPnlAmount(snap.latestEquityDelta()!, true)}
                                </span>
                              </Show>
                            </span>
                          </div>
                          <div class="mode-hero-divider" aria-hidden="true" />
                          <div class="mode-hero-stat">
                            <span class="mode-hero-label">PnL snapshot</span>
                            <span class={`mode-hero-value mono ${pnlClass(latest().sessionPnl)}`}>
                              {formatPnlAmount(latest().sessionPnl, true)}
                            </span>
                            <span class="mode-hero-meta mono">
                              {latest().traderCount} traders · {latest().positionCount} positions
                            </span>
                          </div>
                          <div class="mode-hero-divider" aria-hidden="true" />
                          <div class="mode-hero-stat">
                            <span class="mode-hero-label">Total filtré</span>
                            <span class="mode-hero-value">{snap.total()}</span>
                            <span class="mode-hero-meta">
                              {snap.selected().size > 0
                                ? `${snap.selected().size} sélectionné${snap.selected().size > 1 ? 's' : ''}`
                                : 'Sélectionnez pour comparer'}
                            </span>
                          </div>
                        </div>
                      </section>
                    )}
                  </Show>

                  <SimSnapshotEquityChart items={snap.chartItems()} />

                  <div class="sim-snapshot-list-header">
                    <p class="form-hint sim-snapshot-hint">Cochez des snapshots pour les comparer côte à côte.</p>
                    <div class="event-pagination">
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        disabled={snap.page() === 0}
                        onClick={() => void snap.goToPage(snap.page() - 1)}
                      >
                        Précédent
                      </button>
                      <span class="event-pagination-info">{paginationLabel()}</span>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        disabled={snap.page() >= snap.pageCount() - 1}
                        onClick={() => void snap.goToPage(snap.page() + 1)}
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                  <div class="sim-snapshot-cards">
                    <For each={snap.items()}>
                      {(row) => (
                        <SimSnapshotCard
                          snapshot={row}
                          selected={snap.selected().has(row.id)}
                          onToggle={() => snap.toggleSelected(row.id)}
                          onDetail={() => openDetail(row.id)}
                        />
                      )}
                    </For>
                  </div>

                  <Show when={snap.selectedSummaries().length > 0}>
                    <SimSnapshotComparePanel
                      selected={snap.selectedSummaries()}
                      details={snap.details()}
                      referenceId={snap.referenceId()}
                      onReferenceChange={snap.setReferenceId}
                      configMode={props.compareConfigMode}
                    />
                  </Show>
                </Show>
              </Show>
            </div>
          </Show>
        </CollapsiblePanel>
      </section>

      <SimSnapshotDetailDialog
        open={detailOpen()}
        onClose={() => setDetailOpen(false)}
        detail={activeDetail()}
      />

      {props.renderCreateDialog({ open: createOpen(), onClose: () => setCreateOpen(false), onCreated: () => void snap.refresh(), algoKind: snap.algoKind() })}
      {props.renderSettingsDialog({ open: settingsOpen(), onClose: () => setSettingsOpen(false) })}
      {props.renderArchiveDialog({
        open: archiveOpen(),
        session: archiveSession(),
        onClose: () => {
          setArchiveOpen(false);
          setArchiveSession(null);
        },
      })}
    </>
  );
}
