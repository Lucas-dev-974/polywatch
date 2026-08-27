import { Show } from 'solid-js';
import { formatShortDateTime } from '../lib/date';
import type { E2ePositionDto, E2eRunDto, E2eSuiteDto } from '../lib/e2e-runs';
import {
  e2eStatusLabel,
  e2eSummaryText,
  formatE2eDuration,
} from '../lib/e2e-runs';
import { E2eLivePositions } from './E2eLivePositions';
import { E2eTestResultsList } from './e2e/E2eTestResultsList';

export interface E2eRunSuiteDetailPanelProps {
  run: E2eRunDto;
  suite: E2eSuiteDto | undefined;
  positions: E2ePositionDto[];
  logs: string;
}

export function E2eRunSuiteDetailPanel(props: E2eRunSuiteDetailPanelProps) {
  return (
    <div class="e2e-suite-detail-panel">
      <h3 class="subsection-title">D{'\u00e9'}tails de la suite</h3>

      <div class="e2e-suite-detail-summary">
        <div class="e2e-suite-detail-heading">
          <span class="e2e-suite-detail-label">{props.suite?.label ?? props.run.suite}</span>
          <Show when={props.suite?.description}>
            <p class="text-muted e2e-suite-detail-desc">{props.suite!.description}</p>
          </Show>
        </div>

        <dl class="e2e-suite-detail-meta">
          <div>
            <dt class="text-muted">Statut</dt>
            <dd>
              <span class={`badge e2e-status-badge e2e-status-${props.run.status}`}>
                {e2eStatusLabel(props.run.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-muted">Dur{'\u00e9'}e</dt>
            <dd>{formatE2eDuration(props.run.durationMs)}</dd>
          </div>
          <div>
            <dt class="text-muted">D{'\u00e9'}marr{'\u00e9'}</dt>
            <dd>{formatShortDateTime(props.run.startedAt)}</dd>
          </div>
          <Show when={props.run.finishedAt}>
            <div>
              <dt class="text-muted">Termin{'\u00e9'}</dt>
              <dd>{formatShortDateTime(props.run.finishedAt!)}</dd>
            </div>
          </Show>
          <div>
            <dt class="text-muted">D{'\u00e9'}clench{'\u00e9'} par</dt>
            <dd>{props.run.triggeredBy ?? '\u2014'}</dd>
          </div>
          <div>
            <dt class="text-muted">Exit code</dt>
            <dd>{props.run.exitCode ?? '\u2014'}</dd>
          </div>
          <div>
            <dt class="text-muted">R{'\u00e9'}sum{'\u00e9'}</dt>
            <dd>{e2eSummaryText(props.run.summary)}</dd>
          </div>
          <div>
            <dt class="text-muted">Run ID</dt>
            <dd class="mono">{props.run.id}</dd>
          </div>
        </dl>

        <Show when={props.run.errorMessage}>
          <p class="e2e-error">{props.run.errorMessage}</p>
        </Show>
      </div>

      <Show when={props.positions.length > 0}>
        <E2eLivePositions positions={props.positions} waiting={false} />
      </Show>

      <Show when={(props.run.summary?.tests?.length ?? 0) > 0}>
        <E2eTestResultsList tests={props.run.summary!.tests!} />
      </Show>

      <Show
        when={
          props.run.summary != null &&
          props.run.summary.total > 0 &&
          !props.run.summary.tests?.length
        }
      >
        <p class="text-muted e2e-test-results-empty">
          D{'\u00e9'}tail par test indisponible pour cette ex{'\u00e9'}cution.
        </p>
      </Show>

      <pre class="e2e-log-terminal e2e-log-terminal-sm">
        {props.logs || `Chargement des logs${'\u2026'}`}
      </pre>
    </div>
  );
}
