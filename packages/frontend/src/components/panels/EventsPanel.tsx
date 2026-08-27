import { createSignal, For, onMount, onCleanup, Show, createEffect } from 'solid-js';

import { CollapsiblePanel, useCollapse } from '../CollapsiblePanel';
import { Icon } from '../Icon';
import { MoveEventFilters, type SourceFilter } from '../move-events/MoveEventFilters';
import { MoveEventRow } from '../move-events/MoveEventRow';
import { AlgoEventRow } from '../algo-events/AlgoEventRow';

import { api } from '../../api';
import { connectSocket } from '../../socket';
import type { SimAlgoKind } from '../../lib/simulation';
import {
  MOVE_EVENTS_PAGE_SIZE,
  type ModeFilter,
  type MoveEvent,
  type MoveEventsResponse,
} from '../../lib/move-events';
import type { AlgoEvent, AlgoEventsResponse } from '../../lib/algo-events';

type Props = {
  mode: 'sim' | 'real';
  /** When provided (simulation page), show only this algo's events. */
  algoKind?: SimAlgoKind;
};

const ALGO_EVENTS_PAGE_SIZE = 20;

export function EventsPanel(props: Props) {
  const [copyEvents, setCopyEvents] = createSignal<MoveEvent[]>([]);
  const [algoEvents, setAlgoEvents] = createSignal<AlgoEvent[]>([]);
  const [total, setTotal] = createSignal(0);
  const [clearing, setClearing] = createSignal(false);
  const [collapsed, setCollapsed] = useCollapse('events', props.mode);
  const [modeFilter, setModeFilter] = createSignal<ModeFilter>('all');

  /** Kind-aware view restricts event sources to the active algo. */
  const sourceOptions = (): SourceFilter[] | undefined => {
    if (!props.algoKind) return undefined;
    if (props.algoKind === 'copy') return ['copy'];
    if (props.algoKind === 'crypto') return ['algo'];
    return []; // weather: no events API
  };

  const defaultSource = (): SourceFilter =>
    props.algoKind === 'copy' ? 'copy' : props.algoKind === 'crypto' ? 'algo' : 'all';

  const [sourceFilter, setSourceFilter] = createSignal<SourceFilter>(defaultSource());
  const [page, setPage] = createSignal(0);

  const weatherOnly = () => props.algoKind === 'weather';

  // Reset source filter and reload when the active algo tab changes.
  createEffect(() => {
    const _ = props.algoKind;
    setSourceFilter(defaultSource());
    setPage(0);
    void loadSingleSource();
  });

  function buildCopyQuery(): string {
    const params = new URLSearchParams();
    params.set('limit', String(MOVE_EVENTS_PAGE_SIZE));
    params.set('offset', String(page() * MOVE_EVENTS_PAGE_SIZE));
    const filter = modeFilter();
    if (filter !== 'all') params.set('mode', filter);
    return `/move-events?${params.toString()}`;
  }

  function buildAlgoQuery(): string {
    const params = new URLSearchParams();
    params.set('limit', String(ALGO_EVENTS_PAGE_SIZE));
    params.set('offset', String(page() * ALGO_EVENTS_PAGE_SIZE));
    return `/algo/events?${params.toString()}`;
  }

  // Simplified load for single source to avoid double-fetching
  async function loadSingleSource() {
    const source = sourceFilter();
    if (source === 'copy' || source === 'all') {
      const data = await api<MoveEventsResponse>(buildCopyQuery());
      setCopyEvents(data.items);
      if (source === 'copy') {
        setTotal(data.total);
        return;
      }
    }
    if (source === 'algo' || source === 'all') {
      const data = await api<AlgoEventsResponse>(buildAlgoQuery());
      setAlgoEvents(data.items);
      if (source === 'algo') {
        setTotal(data.total);
        return;
      }
    }
  }

  function setFilter(filter: ModeFilter) {
    setModeFilter(filter);
    setPage(0);
    void loadSingleSource();
  }

  function setSource(filter: SourceFilter) {
    setSourceFilter(filter);
    setPage(0);
    void loadSingleSource();
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / currentPageSize()) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void loadSingleSource();
  }

  const currentPageSize = () => sourceFilter() === 'algo' ? ALGO_EVENTS_PAGE_SIZE : MOVE_EVENTS_PAGE_SIZE;
  const pageCount = () => Math.max(1, Math.ceil(total() / currentPageSize()));

  function countLabel(): string {
    const all = total();
    if (all === 0) return '0';
    return `${all} enregistré${all !== 1 ? 's' : ''}`;
  }

  function paginationLabel(): string {
    const current = page() + 1;
    const pages = pageCount();
    return `Page ${current} / ${pages}`;
  }

  async function clearAll() {
    if (
      !confirm(
        'Supprimer tous les événements enregistrés ?\n\n' +
          'Les nouveaux mouvements détectés continueront d\'apparaître.',
      )
    ) {
      return;
    }

    setClearing(true);
    try {
      await api('/move-events', { method: 'DELETE' });
      setCopyEvents([]);
      setAlgoEvents([]);
      setTotal(0);
      setPage(0);
    } catch (err) {
      alert(
        err instanceof Error
          ? `Échec de la suppression : ${err.message}`
          : 'Échec de la suppression des événements.',
      );
    } finally {
      setClearing(false);
    }
  }

  const emptyMessage = () => {
    const source = sourceFilter();
    if (source === 'algo') return 'Aucun événement AlgoCrypto';
    return 'Aucun mouvement détecté';
  };

  onMount(() => {
    const socket = connectSocket();
    const refresh = () => void loadSingleSource();
    const onReset = (payload?: { algoKind?: SimAlgoKind }) => {
      if (!props.algoKind || !payload?.algoKind || payload.algoKind === props.algoKind) {
        setPage(0);
        void loadSingleSource();
      }
    };
    socket.on('move_detected', refresh);
    socket.on('execution', refresh);
    socket.on('simulation_reset', onReset);
    onCleanup(() => {
      socket.off('move_detected', refresh);
      socket.off('execution', refresh);
      socket.off('simulation_reset', onReset);
    });
  });

  return (
    <section class="panel">
      <div class="panel-header panel-header-stacked">
        <div class="panel-header-row">
          <h2>Événements</h2>
          <div class="panel-header-actions">
            <span class="panel-count">{countLabel()}</span>
            <button
              class="btn btn-secondary btn-sm"
              disabled={clearing() || total() === 0}
              onClick={() => void clearAll()}
            >
              {clearing() ? 'Suppression…' : 'Tout supprimer'}
            </button>
            <button
              class="panel-collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed() ? 'Déplier' : 'Plier'}
            >
              <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
            </button>
          </div>
        </div>
        <MoveEventFilters
          modeFilter={modeFilter}
          onFilterChange={setFilter}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSource}
          sourceOptions={sourceOptions()}
        />
      </div>

      <CollapsiblePanel collapsed={collapsed()}>
        <div class="panel-body-flush panel-scroll">
          <Show
            when={!weatherOnly()}
            fallback={
              <div class="empty-state">
                <div class="empty-state-icon">⚡</div>
                Aucun flux d'événements pour l'algo weather.
              </div>
            }
          >
          <Show
            when={copyEvents().length > 0 || algoEvents().length > 0}
            fallback={
              <div class="empty-state">
                <div class="empty-state-icon">⚡</div>
                {emptyMessage()}
              </div>
            }
          >
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Trader · Marché</th>
                    <th>Type</th>
                    <th>Mise</th>
                    <th>Slippage copy</th>
                    <th>Mode</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  <Show when={sourceFilter() === 'copy'}>
                    <For each={copyEvents()}>{(event) => <MoveEventRow event={event} />}</For>
                  </Show>
                  <Show when={sourceFilter() === 'algo'}>
                    <For each={algoEvents()}>{(event) => <AlgoEventRow event={event} />}</For>
                  </Show>
                  <Show when={sourceFilter() === 'all'}>
                    <For each={copyEvents()}>{(event) => <MoveEventRow event={event} />}</For>
                    <For each={algoEvents()}>{(event) => <AlgoEventRow event={event} />}</For>
                  </Show>
                </tbody>
              </table>
            </div>

            <div class="event-pagination">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={page() === 0}
                onClick={() => goToPage(page() - 1)}
              >
                ← Précédent
              </button>
              <span class="event-pagination-info">{paginationLabel()}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={page() >= pageCount() - 1}
                onClick={() => goToPage(page() + 1)}
              >
                Suivant →
              </button>
            </div>
          </Show>
          </Show>
        </div>
      </CollapsiblePanel>
    </section>
  );
}
