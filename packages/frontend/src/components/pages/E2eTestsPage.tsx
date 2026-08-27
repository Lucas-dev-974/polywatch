import { createSignal, createEffect, For, onMount, onCleanup, Show } from 'solid-js';
import { api, apiText } from '../../api';
import {
  connectSocket,
  onE2eLog,
  onE2ePosition,
  onE2ePositionUpdate,
  onE2eRunFinished,
  onE2eRunStarted,
} from '../../socket';
import { formatShortDateTime } from '../../lib/date';
import { E2eRunStatusBar, useE2eLiveClock } from '../e2e/E2eRunStatusBar';
import { E2eLivePositions } from '../panels/E2eLivePositions';
import { E2eRunSuiteDetailPanel } from '../panels/E2eRunSuiteDetailPanel';
import {
  type E2eRunDto,
  type E2eRunStatus,
  type E2eRunSummary,
  type E2eSuiteDto,
  type E2ePositionDto,
  type E2eHistoryResponse,
  e2eStatusLabel,
  e2eSummaryText,
  e2eSuiteLabel,
  formatE2eDuration,
  parseE2eApiError,
} from '../../lib/e2e-runs';

const LOG_TAIL_LINES = 500;
const MAX_LIVE_LINES = 5000;
const HISTORY_PAGE_SIZE = 20;

export function E2eTestsPage() {
  const [suites, setSuites] = createSignal<E2eSuiteDto[]>([]);
  const [selectedSuite, setSelectedSuite] = createSignal('playwright');
  const [activeRun, setActiveRun] = createSignal<E2eRunDto | null>(null);
  const [liveLogs, setLiveLogs] = createSignal('');
  const [livePositions, setLivePositions] = createSignal<E2ePositionDto[]>([]);
  const [history, setHistory] = createSignal<E2eRunDto[]>([]);
  const [historyTotal, setHistoryTotal] = createSignal(0);
  const [historyOffset, setHistoryOffset] = createSignal(0);
  const [selectedRun, setSelectedRun] = createSignal<E2eRunDto | null>(null);
  const [selectedRunLogs, setSelectedRunLogs] = createSignal('');
  const [selectedRunPositions, setSelectedRunPositions] = createSignal<E2ePositionDto[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [launchError, setLaunchError] = createSignal<string | null>(null);
  const [stopping, setStopping] = createSignal(false);
  let logContainer: HTMLPreElement | undefined;

  const isRunning = () => activeRun()?.status === 'running';
  const nowMs = useE2eLiveClock(isRunning);

  function appendLiveLog(line: string) {
    setLiveLogs((prev) => {
      const next = prev ? `${prev}\n${line}` : line;
      const lines = next.split('\n');
      if (lines.length > MAX_LIVE_LINES) {
        return lines.slice(-MAX_LIVE_LINES).join('\n');
      }
      return next;
    });
  }

  function upsertLivePosition(pos: E2ePositionDto) {
    setLivePositions((prev) => {
      const idx = prev.findIndex((p) => p.id === pos.id);
      if (idx === -1) return [...prev, pos];
      const next = [...prev];
      next[idx] = pos;
      return next;
    });
  }

  createEffect(() => {
    liveLogs();
    if (logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });

  async function loadSuites() {
    const data = await api<E2eSuiteDto[]>('/e2e-runs/suites');
    setSuites(data);
    if (data.length && !data.some((s) => s.id === selectedSuite())) {
      setSelectedSuite(data[0]!.id);
    }
  }

  async function loadHistory(offset = historyOffset()) {
    const data = await api<E2eHistoryResponse>(
      `/e2e-runs?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`,
    );
    setHistory(data.items);
    setHistoryTotal(data.total);
    setHistoryOffset(data.offset);
  }

  async function loadActiveRun() {
    const data = await api<{ run: E2eRunDto | null }>('/e2e-runs/active');
    setActiveRun(data.run);
    if (data.run) {
      setLiveLogs(await apiText(`/e2e-runs/${data.run.id}/logs?tail=${LOG_TAIL_LINES}`));
      const positions = await api<E2ePositionDto[]>(`/e2e-runs/${data.run.id}/positions`);
      setLivePositions(positions);
    } else {
      setLivePositions([]);
    }
  }

  async function handleLaunch() {
    const suite = suites().find((s) => s.id === selectedSuite());
    if (suite?.requiresConfirmation) {
      const ok = window.confirm(
        'Cette suite contacte Polymarket en live et peut durer jusqu\'à 20 minutes. Continuer ?',
      );
      if (!ok) return;
    }

    setLaunchError(null);
    setLoading(true);
    setLiveLogs('');
    setLivePositions([]);
    try {
      setActiveRun(
        await api<E2eRunDto>('/e2e-runs', {
          method: 'POST',
          body: JSON.stringify({ suite: selectedSuite() }),
        }),
      );
    } catch (err) {
      setLaunchError(parseE2eApiError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    const run = activeRun();
    if (!run || run.status !== 'running') return;
    setStopping(true);
    try {
      setActiveRun(
        await api<E2eRunDto>(`/e2e-runs/${run.id}/cancel`, { method: 'POST' }),
      );
      await loadHistory(0);
    } finally {
      setStopping(false);
    }
  }

  async function handleSelectRun(run: E2eRunDto) {
    setSelectedRun(run);
    setSelectedRunLogs('');
    setSelectedRunPositions([]);
    void apiText(`/e2e-runs/${run.id}/logs`).then(setSelectedRunLogs);
    try {
      const fresh = await api<E2eRunDto>(`/e2e-runs/${run.id}`);
      setSelectedRun(fresh);
    } catch {
      // keep optimistic run from history row
    }
    const positions = await api<E2ePositionDto[]>(`/e2e-runs/${run.id}/positions`);
    setSelectedRunPositions(positions);
  }

  function handleBackFromDetail() {
    setSelectedRun(null);
    setSelectedRunLogs('');
    setSelectedRunPositions([]);
  }

  function suiteForRun(run: E2eRunDto) {
    return suites().find((s) => s.id === run.suite);
  }

  onMount(() => {
    connectSocket();
    void loadSuites();
    void loadHistory(0);
    void loadActiveRun();

    const offLog = onE2eLog((payload) => {
      const current = activeRun();
      if (current?.id === payload.runId) appendLiveLog(payload.line);
    });

    const offStarted = onE2eRunStarted(() => {
      void loadActiveRun();
    });

    const offFinished = onE2eRunFinished(async (payload) => {
      try {
        setActiveRun(await api<E2eRunDto>(`/e2e-runs/${payload.runId}`));
      } catch {
        setActiveRun((prev) => {
          if (!prev || prev.id !== payload.runId) return prev;
          return {
            ...prev,
            status: payload.status as E2eRunStatus,
            summary: (payload.summary as E2eRunSummary | null) ?? prev.summary,
            finishedAt: new Date().toISOString(),
          };
        });
      }
      try {
        const positions = await api<E2ePositionDto[]>(`/e2e-runs/${payload.runId}/positions`);
        setLivePositions(positions);
      } catch {
        // ignore
      }
      await loadHistory(0);
    });

    const offPosition = onE2ePosition((payload) => {
      const current = activeRun();
      if (current?.id !== payload.runId) return;
      upsertLivePosition(payload as E2ePositionDto);
    });

    const offPositionUpdate = onE2ePositionUpdate((payload) => {
      const { positionId, currentPrice, pnlPercent } = payload as {
        positionId: string;
        currentPrice: number;
        pnlPercent: number;
      };
      setLivePositions((prev) =>
        prev.map((p) =>
          p.id === positionId
            ? { ...p, currentPrice, pnlPercent }
            : p,
        ),
      );
    });

    onCleanup(() => {
      offLog();
      offStarted();
      offFinished();
      offPosition();
      offPositionUpdate();
    });
  });

  const showLivePositions = () =>
    activeRun()?.suite === 'crypto-algo-real' || livePositions().length > 0;

  return (
    <div class="system-tab-content page-e2e-tests">
      <div class="e2e-tests-page">
      <p class="e2e-tests-subtitle text-muted system-tab-intro">
        Lancez les suites de tests depuis l&apos;interface. Les logs s&apos;affichent en direct.
        Prérequis Playwright : <code>npx playwright install</code>.
        Les tests peuvent être instables si le stack dev est très chargé.
      </p>

      <section class="card e2e-launch-panel">
        <div class="e2e-launch-controls">
          <label class="e2e-suite-select">
            <span class="text-muted">Suite</span>
            <select
              class="input"
              value={selectedSuite()}
              onChange={(e) => setSelectedSuite(e.currentTarget.value)}
              disabled={isRunning() || loading()}
            >
              <For each={suites()}>
                {(suite) => (
                  <option value={suite.id}>
                    {suite.label} — {suite.description}
                  </option>
                )}
              </For>
            </select>
          </label>
          <div class="e2e-launch-actions">
            <button
              class="btn btn-primary btn-sm"
              disabled={isRunning() || loading()}
              onClick={() => void handleLaunch()}
            >
              {loading() ? 'Lancement…' : 'Lancer'}
            </button>
          </div>
        </div>

        <Show when={launchError()}>
          <p class="e2e-error">{launchError()}</p>
        </Show>

        <Show when={activeRun()}>
          {(run) => (
            <E2eRunStatusBar
              run={run()}
              suites={suites()}
              nowMs={nowMs()}
              stopping={stopping()}
              onStop={() => void handleCancel()}
            />
          )}
        </Show>

        <Show when={showLivePositions()}>
          <E2eLivePositions positions={livePositions()} waiting={isRunning()} />
        </Show>

        <pre class="e2e-log-terminal" ref={logContainer}>
          {liveLogs() || (isRunning() ? 'En attente de logs…' : 'Aucun log pour le moment.')}
        </pre>
      </section>

      <section class="card e2e-history-panel">
        <Show
          when={selectedRun()}
          fallback={
            <>
              <div class="e2e-history-header">
                <h3 class="subsection-title">Historique</h3>
                <span class="text-muted">{historyTotal()} exécution(s)</span>
              </div>

              <div class="e2e-history-table-wrap">
                <table class="data-table e2e-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Suite</th>
                      <th>Statut</th>
                      <th>Durée</th>
                      <th>Résumé</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={history()}>
                      {(run) => (
                        <tr onClick={() => void handleSelectRun(run)}>
                          <td>{formatShortDateTime(run.startedAt)}</td>
                          <td>{e2eSuiteLabel(suites(), run.suite)}</td>
                          <td>
                            <span class={`badge e2e-status-badge e2e-status-${run.status}`}>
                              {e2eStatusLabel(run.status)}
                            </span>
                          </td>
                          <td>{formatE2eDuration(run.durationMs)}</td>
                          <td>{e2eSummaryText(run.summary)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>

              <div class="e2e-history-pagination">
                <button
                  class="btn btn-ghost btn-sm"
                  disabled={historyOffset() <= 0}
                  onClick={() => void loadHistory(Math.max(0, historyOffset() - HISTORY_PAGE_SIZE))}
                >
                  Précédent
                </button>
                <span class="text-muted">
                  {historyOffset() + 1}–
                  {Math.min(historyOffset() + HISTORY_PAGE_SIZE, historyTotal())} / {historyTotal()}
                </span>
                <button
                  class="btn btn-ghost btn-sm"
                  disabled={historyOffset() + HISTORY_PAGE_SIZE >= historyTotal()}
                  onClick={() => void loadHistory(historyOffset() + HISTORY_PAGE_SIZE)}
                >
                  Suivant
                </button>
              </div>
            </>
          }
        >
          {(run) => (
            <div class="e2e-run-detail">
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                onClick={handleBackFromDetail}
              >
                ← Retour à l'historique
              </button>

              <E2eRunSuiteDetailPanel
                run={run()}
                suite={suiteForRun(run())}
                positions={selectedRunPositions()}
                logs={selectedRunLogs()}
              />
            </div>
          )}
        </Show>
      </section>
      </div>
    </div>
  );
}

