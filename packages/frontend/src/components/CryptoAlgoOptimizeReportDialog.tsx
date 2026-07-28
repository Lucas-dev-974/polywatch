import { Show, createEffect, createSignal } from 'solid-js';
import type { CryptoAlgoOptimizeReport } from '@polywatch/core';
import { formatShortDateTime } from '../lib/date';
import {
  applyRecommendedCryptoAlgoConfig,
  fetchCryptoAlgoOptimizeReport,
  fetchCurrentCryptoAlgoConfigFingerprint,
} from '../lib/crypto-algo-optimize-report';
import { Dialog } from './Dialog';
import { CryptoAlgoReportViewer } from './CryptoAlgoReportViewer';
import { NewSessionResetDialog } from './NewSessionResetDialog';

export interface CryptoAlgoOptimizeReportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CryptoAlgoOptimizeReportDialog(props: CryptoAlgoOptimizeReportDialogProps) {
  const [report, setReport] = createSignal<CryptoAlgoOptimizeReport | null>(null);
  const [configFingerprint, setConfigFingerprint] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [applySuccess, setApplySuccess] = createSignal<string | null>(null);
  const [newSessionOpen, setNewSessionOpen] = createSignal(false);
  const [newSessionLabel, setNewSessionLabel] = createSignal<string | undefined>();

  async function load() {
    setLoading(true);
    setError(null);
    setApplySuccess(null);
    try {
      const data = await fetchCryptoAlgoOptimizeReport();
      setReport(data);
      setConfigFingerprint(data.configFingerprint);
    } catch (err) {
      setReport(null);
      setConfigFingerprint(null);
      setError(err instanceof Error ? err.message : 'Échec du chargement');
    } finally {
      setLoading(false);
    }
  }

  async function applyRecommended() {
    const r = report();
    const fp = configFingerprint();
    if (!r?.recommendedConfig.applicable || !fp) return;

    const summary = r.recommendedConfig.changes
      .map((c) => `${c.label}: ${c.from} → ${c.to}`)
      .join('\n');
    const ok = window.confirm(
      `Appliquer ${r.recommendedConfig.changes.length} paramètre(s) crypto_algo_* recommandé(s) ?\n\n${summary}\n\nMet à jour risk_config (Crypto Algo uniquement — pas copy trading).`,
    );
    if (!ok) return;

    setApplying(true);
    setError(null);
    setApplySuccess(null);
    try {
      const current = await fetchCurrentCryptoAlgoConfigFingerprint();
      if (current !== fp) {
        throw new Error(
          'La config live a changé depuis la génération du rapport. Régénérez avant d’appliquer.',
        );
      }
      await applyRecommendedCryptoAlgoConfig(r, fp);
      setApplySuccess('Paramètres recommandés appliqués.');
      setNewSessionLabel(`Post-rapport ${formatShortDateTime(r.generatedAt)}`);
      setNewSessionOpen(true);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Échec de l’application des paramètres',
      );
    } finally {
      setApplying(false);
    }
  }

  createEffect(() => {
    if (props.open) void load();
  });

  const title = () => {
    const r = report();
    if (!r) return 'Rapport Crypto Algo (sim)';
    return `Rapport Crypto Algo (sim) · ${formatShortDateTime(r.generatedAt)}`;
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={title()}
      titleId="crypto-algo-optimize-report-title"
      class="dialog-metrics crypto-algo-optimize-report-dialog"
      bodyClass="dialog-body-metrics crypto-algo-optimize-report-body"
      headerExtra={
        <Show when={!loading()}>
          <Show when={report()?.recommendedConfig.applicable}>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={applying()}
              onClick={() => void applyRecommended()}
            >
              {applying() ? 'Application…' : 'Appliquer recommandations'}
            </button>
          </Show>
          <button type="button" class="btn btn-ghost btn-sm" onClick={() => void load()}>
            Régénérer
          </button>
        </Show>
      }
    >
      <Show when={loading()}>
        <p class="form-hint">Analyse des positions Crypto Algo sim (ALGO_OPEN)…</p>
      </Show>
      <Show when={error()}>
        <p class="form-error">{error()}</p>
      </Show>
      <Show when={applySuccess()}>
        <p class="form-hint crypto-algo-optimize-report-success">{applySuccess()}</p>
      </Show>
      <Show when={report()}>
        {(r) => (
          <CryptoAlgoReportViewer
            report={r()}
            configFingerprint={configFingerprint()}
            applying={applying()}
            onApplyRecommended={() => void applyRecommended()}
          />
        )}
      </Show>
      <NewSessionResetDialog
        open={newSessionOpen()}
        onClose={() => setNewSessionOpen(false)}
        mode="post-apply"
        defaultLabel={newSessionLabel()}
        algoKind="crypto"
        onDone={() => {
          setApplySuccess((prev) =>
            prev ? `${prev} Session sim réinitialisée.` : 'Session sim réinitialisée.',
          );
        }}
      />
    </Dialog>
  );
}

export interface CryptoAlgoOptimizeReportDialogTriggerProps {
  onOpenReportsPage?: () => void;
}

export function CryptoAlgoOptimizeReportDialogTrigger(
  props: CryptoAlgoOptimizeReportDialogTriggerProps = {},
) {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        title="Rapport d’optimisation Crypto Algo (sim, ALGO_OPEN — hors copy trading)"
        onClick={() => setOpen(true)}
      >
        Rapport
      </button>
      <Show when={props.onOpenReportsPage}>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          title="Ouvrir le hub Rapports"
          onClick={() => props.onOpenReportsPage?.()}
        >
          Hub
        </button>
      </Show>
      <CryptoAlgoOptimizeReportDialog open={open()} onClose={() => setOpen(false)} />
    </>
  );
}
