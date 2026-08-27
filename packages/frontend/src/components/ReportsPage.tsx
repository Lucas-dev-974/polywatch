import { createEffect, createSignal, For, Show } from 'solid-js';
import type { AnalysisReportDetail, AnalysisReportSummary } from '@polywatch/core';
import { formatShortDateTime } from '../lib/date';
import { formatPnlAmount, pnlClass } from '../lib/position';
import {
  applyRecommendedCryptoAlgoConfig,
  compareAnalysisReports,
  deleteAnalysisReport,
  fetchAnalysisReport,
  fetchAnalysisReports,
  fetchCurrentCryptoAlgoConfigFingerprint,
  generateAnalysisReport,
} from '../lib/analysis-reports';
import { AnalysisReportComparePanel } from './AnalysisReportComparePanel';
import { CryptoAlgoReportViewer } from './CryptoAlgoReportViewer';
import { NewSessionResetDialog } from './dialogs/NewSessionResetDialog';

function toIsoStart(dateStr: string): string | null {
  if (!dateStr.trim()) return null;
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function toIsoEnd(dateStr: string): string | null {
  if (!dateStr.trim()) return null;
  return new Date(`${dateStr}T23:59:59.999`).toISOString();
}

export function ReportsPage() {
  const [items, setItems] = createSignal<AnalysisReportSummary[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loadingList, setLoadingList] = createSignal(true);
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [detail, setDetail] = createSignal<AnalysisReportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [closedFrom, setClosedFrom] = createSignal('');
  const [closedTo, setClosedTo] = createSignal('');
  const [note, setNote] = createSignal('');
  const [compareA, setCompareA] = createSignal<number | null>(null);
  const [compareB, setCompareB] = createSignal<number | null>(null);
  const [compareData, setCompareData] = createSignal<
    Awaited<ReturnType<typeof compareAnalysisReports>> | null
  >(null);
  const [compareLoading, setCompareLoading] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<'detail' | 'compare'>('detail');
  const [newSessionOpen, setNewSessionOpen] = createSignal(false);
  const [newSessionLabel, setNewSessionLabel] = createSignal<string | undefined>();

  async function loadList() {
    setLoadingList(true);
    try {
      const data = await fetchAnalysisReports({ limit: 50 });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du chargement des rapports');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(id: number) {
    setLoadingDetail(true);
    setError(null);
    try {
      setDetail(await fetchAnalysisReport(id));
      setSelectedId(id);
      setViewMode('detail');
      setCompareData(null);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Échec du chargement du rapport');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await generateAnalysisReport({
        type: 'crypto_algo_optimize',
        note: note().trim() || null,
        params: {
          closedFrom: toIsoStart(closedFrom()),
          closedTo: toIsoEnd(closedTo()),
        },
      });
      await loadList();
      setDetail(saved);
      setSelectedId(saved.id);
      setViewMode('detail');
      setSuccess('Rapport généré et enregistré.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la génération');
    } finally {
      setGenerating(false);
    }
  }

  async function removeReport(id: number) {
    if (!confirm('Supprimer ce rapport ?')) return;
    setError(null);
    try {
      await deleteAnalysisReport(id);
      if (selectedId() === id) {
        setSelectedId(null);
        setDetail(null);
      }
      if (compareA() === id) setCompareA(null);
      if (compareB() === id) setCompareB(null);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la suppression');
    }
  }

  async function runCompare() {
    const a = compareA();
    const b = compareB();
    if (a == null || b == null || a === b) {
      setError('Sélectionnez deux rapports distincts pour comparer.');
      return;
    }
    setCompareLoading(true);
    setError(null);
    try {
      setCompareData(await compareAnalysisReports(a, b));
      setViewMode('compare');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la comparaison');
    } finally {
      setCompareLoading(false);
    }
  }

  async function applyRecommended() {
    const d = detail();
    if (!d?.payload.recommendedConfig.applicable) return;

    const summary = d.payload.recommendedConfig.changes
      .map((c) => `${c.label}: ${c.from} → ${c.to}`)
      .join('\n');
    const ok = window.confirm(
      `Appliquer ${d.payload.recommendedConfig.changes.length} paramètre(s) crypto_algo_* ?\n\n${summary}\n\nFingerprint attendu : ${d.configFingerprint}`,
    );
    if (!ok) return;

    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const current = await fetchCurrentCryptoAlgoConfigFingerprint();
      if (current !== d.configFingerprint) {
        throw new Error(
          'La config live a changé depuis la génération du rapport. Régénérez le rapport avant d’appliquer.',
        );
      }
      await applyRecommendedCryptoAlgoConfig(d.payload, d.configFingerprint);
      setSuccess('Paramètres recommandés appliqués.');
      const refreshed = await generateAnalysisReport({
        type: 'crypto_algo_optimize',
        note: 'Post-application des recommandations',
        params: d.params,
      });
      await loadList();
      setDetail(refreshed);
      setSelectedId(refreshed.id);
      setNewSessionLabel(`Post-rapport ${formatShortDateTime(refreshed.createdAt)}`);
      setNewSessionOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’application');
    } finally {
      setApplying(false);
    }
  }

  function toggleComparePick(id: number) {
    if (compareA() === id) {
      setCompareA(null);
      return;
    }
    if (compareB() === id) {
      setCompareB(null);
      return;
    }
    if (compareA() == null) {
      setCompareA(id);
      return;
    }
    if (compareB() == null) {
      setCompareB(id);
      return;
    }
    setCompareB(id);
  }

  createEffect(() => {
    void loadList();
  });

  return (
    <div class="system-tab-content page-reports">
      <p class="form-hint system-tab-intro">
        Hub d’analyse — génération auto-enregistrée, historique et comparaison de snapshots.
      </p>

      <Show when={error()}>
        <div class="alert error">
          <div class="alert-content">
            <div class="alert-message">{error()}</div>
          </div>
        </div>
      </Show>
      <Show when={success()}>
        <p class="form-hint crypto-algo-optimize-report-success">{success()}</p>
      </Show>

      <div class="reports-layout">
        <aside class="reports-sidebar panel">
          <div class="panel-header">
            <h2>Bibliothèque</h2>
            <span class="panel-count">{total()}</span>
          </div>
          <div class="panel-body reports-editor">
            <h3 class="sim-analytics-section-title">Nouveau rapport</h3>
            <label class="form-label">
              Période fermées — du
              <input
                type="date"
                class="input"
                value={closedFrom()}
                onInput={(e) => setClosedFrom(e.currentTarget.value)}
              />
            </label>
            <label class="form-label">
              au
              <input
                type="date"
                class="input"
                value={closedTo()}
                onInput={(e) => setClosedTo(e.currentTarget.value)}
              />
            </label>
            <label class="form-label">
              Note (optionnel)
              <input
                type="text"
                class="input"
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
                placeholder="ex. avant trailing"
              />
            </label>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={generating()}
              onClick={() => void generate()}
            >
              {generating() ? 'Génération…' : 'Générer Crypto Algo (sim)'}
            </button>
            <p class="form-hint">
              Chaque génération est enregistrée automatiquement (max 50 / 90 jours).
            </p>

            <div class="reports-compare-picks">
              <h3 class="sim-analytics-section-title">Comparer</h3>
              <p class="form-hint">
                A #{compareA() ?? '—'} · B #{compareB() ?? '—'}
              </p>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                disabled={compareLoading()}
                onClick={() => void runCompare()}
              >
                {compareLoading() ? 'Comparaison…' : 'Comparer A vs B'}
              </button>
            </div>
          </div>

          <Show when={loadingList()}>
            <p class="form-hint panel-body">Chargement…</p>
          </Show>
          <ul class="reports-list">
            <For each={items()}>
              {(item) => (
                <li
                  class="reports-list-item"
                  classList={{
                    'is-selected': selectedId() === item.id,
                    'is-compare-a': compareA() === item.id,
                    'is-compare-b': compareB() === item.id,
                  }}
                >
                  <button
                    type="button"
                    class="reports-list-open"
                    onClick={() => void loadDetail(item.id)}
                  >
                    <span class="reports-list-label">{item.label}</span>
                    <span class="form-hint">{formatShortDateTime(item.createdAt)}</span>
                    <span class="form-hint">{item.scopeSummary}</span>
                    <Show when={item.realizedAlgo != null}>
                      <span class={`reports-list-pnl ${pnlClass(item.realizedAlgo!)}`}>
                        {formatPnlAmount(item.realizedAlgo!, true)}
                      </span>
                    </Show>
                  </button>
                  <div class="reports-list-actions">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      title="Sélectionner pour comparaison"
                      onClick={() => toggleComparePick(item.id)}
                    >
                      A/B
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onClick={() => void removeReport(item.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </aside>

        <section class="reports-main">
          <Show when={viewMode() === 'compare' && compareData()}>
            {(data) => <AnalysisReportComparePanel data={data()} />}
          </Show>

          <Show when={viewMode() === 'detail'}>
            <Show when={loadingDetail()}>
              <p class="form-hint">Chargement du rapport…</p>
            </Show>
            <Show when={!loadingDetail() && !detail()}>
              <div class="panel">
                <div class="panel-body">
                  <p class="form-hint">
                    Générez un rapport ou sélectionnez-en un dans la bibliothèque.
                  </p>
                </div>
              </div>
            </Show>
            <Show when={detail()}>
              {(d) => (
                <div class="panel reports-viewer-panel">
                  <div class="panel-header">
                    <div>
                      <h2>{d().label}</h2>
                      <p class="form-hint">
                        {formatShortDateTime(d().createdAt)} · {d().scopeSummary}
                      </p>
                    </div>
                    <Show when={d().payload.recommendedConfig.applicable}>
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled={applying()}
                        onClick={() => void applyRecommended()}
                      >
                        {applying() ? 'Application…' : 'Appliquer recommandations'}
                      </button>
                    </Show>
                  </div>
                  <div class="panel-body crypto-algo-optimize-report-body">
                    <CryptoAlgoReportViewer
                      report={d().payload}
                      configFingerprint={d().configFingerprint}
                      applying={applying()}
                      onApplyRecommended={() => void applyRecommended()}
                    />
                  </div>
                </div>
              )}
            </Show>
          </Show>
        </section>
      </div>
      <NewSessionResetDialog
        open={newSessionOpen()}
        onClose={() => setNewSessionOpen(false)}
        mode="post-apply"
        defaultLabel={newSessionLabel()}
        algoKind="crypto"
        onDone={() => {
          setSuccess((prev) =>
            prev ? `${prev} Session sim réinitialisée.` : 'Session sim réinitialisée.',
          );
        }}
      />
    </div>
  );
}
