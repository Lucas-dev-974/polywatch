import { For, Show } from 'solid-js';
import { formatShortDateTime } from '../../lib/date';
import { formatPnlAmount, pnlClass } from '../../lib/position';
import {
  formatSessionDuration,
  type SimSessionSummary,
} from '../../lib/simulation-sessions';
import {
  configDiffGroupLabel,
  groupConfigDiffPreviewLines,
  type ConfigDiffPreviewLine,
} from '../../lib/snapshot-config-diff';
import type { SimArchiveSummary } from '@polywatch/core';
import { SessionElapsed } from '../SessionElapsed';

interface Props {
  session: SimSessionSummary & { archiveSummary?: SimArchiveSummary | null };
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /** When ≥2 sessions are selected — only differing config params, grouped by pipeline. */
  configDiffPreview?: {
    loading: boolean;
    error: boolean;
    lines: ConfigDiffPreviewLine[];
  } | null;
}

export function SimSessionCard(props: Props) {
  const isActive = () => props.session.status === 'active';
  const pnl = () => props.session.sessionPnl ?? props.session.endingSessionPnl ?? 0;
  const equity = () =>
    props.session.endingEquity ?? props.session.peakEquity ?? props.session.baselineCapital;
  const showConfigDiff = () => props.selected && props.configDiffPreview != null;

  return (
    <div
      class="sim-session-card"
      classList={{ active: isActive(), selected: props.selected }}
    >
      <label class="sim-snapshot-card-check">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={() => props.onToggle()}
        />
        <span class="sim-snapshot-card-check-label">Comparer</span>
      </label>
      <div class="sim-session-card-header">
        <span class={`badge badge-xs ${isActive() ? 'success' : 'neutral'}`}>
          {isActive() ? 'Active' : 'Fermée'}
        </span>
        <time class="sim-session-card-date">
          {formatShortDateTime(props.session.startedAt)}
          {props.session.endedAt
            ? ` → ${formatShortDateTime(props.session.endedAt)}`
            : ' → en cours'}
        </time>
      </div>
      <div class="sim-session-card-label">
        {props.session.label?.trim() || `Session #${props.session.id}`}
      </div>
      <Show when={isActive()}>
        <div class="sim-session-card-elapsed">
          <span class="sim-session-card-elapsed-label">Écoulé</span>
          <SessionElapsed
            startedAt={props.session.startedAt}
            endedAt={props.session.endedAt}
            live
            class="sim-session-card-elapsed-value"
          />
        </div>
      </Show>
      <div class="sim-session-card-equity stat-value mono">
        {formatPnlAmount(equity())}
      </div>
      <div class={`sim-session-card-pnl mono ${pnlClass(pnl())}`}>
        PnL {formatPnlAmount(pnl(), true)}
      </div>
      <div class="sim-session-card-meta">
        {props.session.snapshotCount} snapshot
        {props.session.snapshotCount !== 1 ? 's' : ''} ·{' '}
        <Show
          when={isActive()}
          fallback={formatSessionDuration(props.session.durationMs)}
        >
          <SessionElapsed
            startedAt={props.session.startedAt}
            endedAt={props.session.endedAt}
            live
            showLiveBadge={false}
          />
        </Show>
        {' '}
        · baseline {formatPnlAmount(props.session.baselineCapital)}
      </div>

      <Show when={showConfigDiff()}>
        <div class="sim-session-card-config-diff">
          <div class="sim-session-card-config-diff-title">Diff config</div>
          <p class="sim-session-card-config-diff-hint">
            Copy (lane) + Crypto Algo · réf. = session de référence
          </p>
          <Show when={props.configDiffPreview?.loading}>
            <p class="sim-session-card-config-diff-hint">Chargement…</p>
          </Show>
          <Show when={!props.configDiffPreview?.loading && props.configDiffPreview?.error}>
            <p class="sim-session-card-config-diff-hint">Échec chargement config</p>
          </Show>
          <Show
            when={
              !props.configDiffPreview?.loading &&
              !props.configDiffPreview?.error &&
              (props.configDiffPreview?.lines.length ?? 0) === 0
            }
          >
            <p class="sim-session-card-config-diff-hint">Config identique</p>
          </Show>
          <Show
            when={
              !props.configDiffPreview?.loading &&
              !props.configDiffPreview?.error &&
              (props.configDiffPreview?.lines.length ?? 0) > 0
            }
          >
            <For each={groupConfigDiffPreviewLines(props.configDiffPreview?.lines ?? [])}>
              {([group, groupLines]) => (
                <div class="sim-session-card-config-diff-group">
                  <div class="sim-session-card-config-diff-group-title">
                    {configDiffGroupLabel(group)}
                  </div>
                  <ul class="sim-session-card-config-diff-list">
                    <For each={groupLines}>
                      {(line) => (
                        <li>
                          <span class="sim-session-card-config-diff-label">
                            {line.label}
                          </span>
                          <span class="sim-session-card-config-diff-change mono">
                            {line.changeLabel}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <div class="sim-session-card-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onClick={() => props.onOpen()}
        >
          Voir snapshots
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => props.onRename()}
        >
          Renommer
        </button>
        <Show when={!isActive() && props.session.archiveSummary}>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => props.onArchive?.()}
          >
            Archive
          </button>
        </Show>
        <Show when={!isActive() && props.onDelete}>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => props.onDelete?.()}
          >
            Supprimer
          </button>
        </Show>
      </div>
    </div>
  );
}
