import { createSignal, For, Show } from 'solid-js';
import type { E2eTestCaseSummary } from '../lib/e2e-runs';
import { e2eTestCaseStatusLabel, formatE2eDuration } from '../lib/e2e-runs';

export interface E2eTestResultsListProps {
  tests: E2eTestCaseSummary[];
}

function testTitle(test: E2eTestCaseSummary): string {
  return test.title ?? test.name;
}

function testDescription(test: E2eTestCaseSummary): string {
  if (test.description) return test.description;
  if (test.title && test.name !== test.title && test.name.endsWith(test.title)) {
    const prefix = test.name.slice(0, test.name.length - test.title.length).trim();
    if (prefix) return prefix;
  }
  return '\u2014';
}

function testRowKey(test: E2eTestCaseSummary, index: number): string {
  return `${index}:${test.name}:${test.status}`;
}

function isExpandable(test: E2eTestCaseSummary): boolean {
  return (test.failureMessages?.length ?? 0) > 0;
}

export function E2eTestResultsList(props: E2eTestResultsListProps) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div class="e2e-test-results">
      <h4 class="subsection-title">Tests de la suite</h4>
      <div class="e2e-test-results-table-wrap">
        <table class="data-table e2e-test-results-table">
          <thead>
            <tr>
              <th>Statut</th>
              <th>Titre (it)</th>
              <th>Description (describe)</th>
              <th>Dur{'\u00e9'}e</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.tests}>
              {(test, index) => {
                const rowKey = () => testRowKey(test, index());
                const expandable = () => isExpandable(test);
                const isOpen = () => expanded().has(rowKey());
                return (
                  <>
                    <tr
                      classList={{
                        'e2e-test-row': true,
                        [`e2e-status-${test.status}`]: true,
                        'e2e-test-row-expandable': expandable(),
                        'e2e-test-row-expanded': isOpen(),
                      }}
                      onClick={() => {
                        if (expandable()) toggle(rowKey());
                      }}
                    >
                      <td>
                        <span class={`badge e2e-status-badge e2e-status-${test.status}`}>
                          {e2eTestCaseStatusLabel(test.status)}
                        </span>
                      </td>
                      <td class="e2e-test-title-cell">
                        <Show when={expandable()}>
                          <span class="e2e-test-chevron" aria-hidden="true">
                            {isOpen() ? '\u25BE' : '\u25B8'}
                          </span>
                        </Show>
                        <span>{testTitle(test)}</span>
                      </td>
                      <td class="text-muted e2e-test-desc-cell">{testDescription(test)}</td>
                      <td class="text-muted e2e-test-duration-cell">
                        {test.durationMs != null ? formatE2eDuration(test.durationMs) : '\u2014'}
                      </td>
                    </tr>
                    <Show when={expandable() && isOpen()}>
                      <tr class="e2e-test-failure-row">
                        <td colspan="4">
                          <pre class="e2e-test-failure">{test.failureMessages!.join('\n\n')}</pre>
                        </td>
                      </tr>
                    </Show>
                  </>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}
