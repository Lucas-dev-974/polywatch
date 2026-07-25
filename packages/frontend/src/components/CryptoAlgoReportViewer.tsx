import { For, Show, createMemo } from 'solid-js';
import type { CryptoAlgoOptimizeReport } from '@polywatch/core';
import { formatPnlAmount, pnlClass } from '../lib/position';

function formatCryptoAlgoSizingLine(config: CryptoAlgoOptimizeReport['config']): string {
  if (config.cryptoAlgoSizingMode === 'fixed_shares') {
    return `fixed_shares · ${config.cryptoAlgoEntryShareCount ?? '—'} shares`;
  }
  return `fixed_usdc · ${config.cryptoAlgoEntryUsdcAmount ?? '—'} USDC`;
}

function entryBucketLabel(bucket: string): string {
  switch (bucket) {
    case 'a_<0.55':
      return '< 0.55';
    case 'b_0.55-0.60':
      return '0.55–0.60';
    case 'c_0.60-0.65':
      return '0.60–0.65';
    case 'd_0.65-0.70':
      return '0.65–0.70';
    case 'e_>=0.70':
      return '≥ 0.70';
    default:
      return bucket;
  }
}

function peakBucketLabel(bucket: string): string {
  switch (bucket) {
    case 'peak_<0':
      return 'Peak < 0 %';
    case 'peak_0-10':
      return 'Peak 0–10 %';
    case 'peak_10-30':
      return 'Peak 10–30 %';
    case 'peak_30-50':
      return 'Peak 30–50 %';
    case 'peak_>=50':
      return 'Peak ≥ 50 %';
    case 'null':
      return 'Peak inconnu';
    default:
      return bucket;
  }
}

function verdictAlertClass(tone: CryptoAlgoOptimizeReport['verdict']['tone']): string {
  switch (tone) {
    case 'success':
      return 'info';
    case 'danger':
      return 'error';
    case 'warning':
      return 'warn';
    default:
      return 'info';
  }
}

function formatBool(v: boolean): string {
  return v ? 'Oui' : 'Non';
}

function formatOptionalNum(v: number | null | undefined, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v}${suffix}`;
}

function ReportScopeBanner(props: { closed: number; total: number }) {
  return (
    <div class="alert info crypto-algo-optimize-report-scope-banner">
      <div class="alert-content">
        <div class="alert-type">Périmètre du rapport</div>
        <div class="alert-message">
          <p class="crypto-algo-optimize-report-scope-lead">
            <strong>Crypto Algo · simulation uniquement</strong> — positions{' '}
            <code>mode=sim</code> · <code>reason=ALGO_OPEN</code> ({props.closed} fermées /{' '}
            {props.total} total).
          </p>
          <ul class="crypto-algo-optimize-report-scope-list">
            <li>
              <strong>Inclus :</strong> perf, surveillance, sorties et tunables{' '}
              <code>crypto_algo_*</code> des positions ouvertes par l’algo en sim.
            </li>
            <li>
              <strong>Exclu :</strong> copy trading (<code>COPY_OPEN</code>, etc.), mode réel, et
              toute autre source de positions sim.
            </li>
            <li>
              <strong>Contexte seulement :</strong> le cash sim affiché est le solde global du
              ledger sim (tous modes) — il ne mesure pas le PnL algo seul.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function CloseReasonBars(props: { rows: CryptoAlgoOptimizeReport['byCloseReason'] }) {
  const scale = createMemo(() => {
    const values = props.rows.map((r) => Math.abs(r.sumPnl));
    return Math.max(...values, 1);
  });

  return (
    <section class="sim-analytics-rank crypto-algo-optimize-report-bars">
      <For each={props.rows}>
        {(row) => (
          <div class="sim-analytics-rank-row">
            <span class="sim-analytics-rank-label">
              {row.closeReason}
              <span class="sim-analytics-category-count"> ({row.count})</span>
            </span>
            <div class="sim-analytics-rank-bar-wrap">
              <div
                class="sim-analytics-rank-bar"
                classList={{
                  'is-positive': row.sumPnl > 0,
                  'is-negative': row.sumPnl < 0,
                  'is-flat': row.sumPnl === 0,
                }}
                style={{ width: `${(Math.abs(row.sumPnl) / scale()) * 100}%` }}
              />
            </div>
            <span class={`sim-analytics-rank-value ${pnlClass(row.sumPnl)}`}>
              {formatPnlAmount(row.sumPnl, true)}
            </span>
          </div>
        )}
      </For>
    </section>
  );
}

export interface CryptoAlgoReportViewerProps {
  report: CryptoAlgoOptimizeReport;
  configFingerprint?: string | null;
  applying?: boolean;
  onApplyRecommended?: () => void;
}

export function CryptoAlgoReportViewer(props: CryptoAlgoReportViewerProps) {
  return (
    <div class="crypto-algo-optimize-report">
      <ReportScopeBanner closed={props.report.totals.closed} total={props.report.totals.all} />

      <Show when={props.configFingerprint}>
        <p class="form-hint crypto-algo-report-fingerprint">
          Config fingerprint : <code>{props.configFingerprint}</code>
        </p>
      </Show>

      <div class="crypto-algo-optimize-report-stats">
        <div class="crypto-algo-optimize-report-stat">
          <span class="crypto-algo-optimize-report-stat-label">PnL Crypto Algo (sim, fermées)</span>
          <span
            class={`crypto-algo-optimize-report-stat-value ${pnlClass(props.report.totals.realizedAlgo)}`}
          >
            {formatPnlAmount(props.report.totals.realizedAlgo, true)}
          </span>
        </div>
        <div class="crypto-algo-optimize-report-stat">
          <span class="crypto-algo-optimize-report-stat-label">
            Cash sim (global, hors périmètre)
          </span>
          <span class="crypto-algo-optimize-report-stat-value">
            {props.report.balance.cash.toFixed(2)} / {props.report.balance.baseline.toFixed(0)} pUSD
          </span>
        </div>
        <div class="crypto-algo-optimize-report-stat">
          <span class="crypto-algo-optimize-report-stat-label">Win rate algo (fermées)</span>
          <span class="crypto-algo-optimize-report-stat-value">
            {props.report.totals.winRateClosed != null
              ? `${props.report.totals.winRateClosed}%`
              : '—'}
          </span>
        </div>
        <div class="crypto-algo-optimize-report-stat">
          <span class="crypto-algo-optimize-report-stat-label">Cancelled algo</span>
          <span class="crypto-algo-optimize-report-stat-value">
            {props.report.totals.cancelled}
            {props.report.totals.cancelledPct != null
              ? ` (${props.report.totals.cancelledPct}%)`
              : ''}
          </span>
        </div>
      </div>

      <div
        class={`alert ${verdictAlertClass(props.report.verdict.tone)} crypto-algo-optimize-report-verdict`}
      >
        <div class="alert-content">
          <div class="alert-type">{props.report.verdict.title}</div>
          <div class="alert-message">{props.report.verdict.detail}</div>
        </div>
      </div>

      <section class="crypto-algo-optimize-report-section">
        <h3 class="sim-analytics-section-title">
          Config live Crypto Algo
          <span class="sim-analytics-category-scope"> · tunables crypto_algo_* (risk_config)</span>
        </h3>
        <table class="data-table crypto-algo-optimize-report-table">
          <tbody>
            <tr>
              <th>Stratégies</th>
              <td>{props.report.config.cryptoAlgoStrategies ?? '—'}</td>
            </tr>
            <tr>
              <th>SL</th>
              <td>
                {formatBool(props.report.config.cryptoAlgoSlEnabled)}
                {props.report.config.cryptoAlgoSlBidPoints != null
                  ? ` · ${props.report.config.cryptoAlgoSlBidPoints} bid pts`
                  : ''}
              </td>
            </tr>
            <tr>
              <th>TP / Trailing</th>
              <td>
                TP {formatBool(props.report.config.cryptoAlgoTpEnabled)} · Trailing{' '}
                {formatBool(props.report.config.cryptoAlgoTrailingEnabled)}
              </td>
            </tr>
            <tr>
              <th>Pre-close</th>
              <td>
                Pre-close {formatBool(props.report.config.cryptoAlgoPreCloseEnabled)}
                {props.report.config.cryptoAlgoPreCloseSeconds != null
                  ? ` (${props.report.config.cryptoAlgoPreCloseSeconds}s)`
                  : ''}
              </td>
            </tr>
            <tr>
              <th>sl_confirmation_ticks</th>
              <td>{formatOptionalNum(props.report.config.slConfirmationTicks)}</td>
            </tr>
            <tr>
              <th>Sizing crypto</th>
              <td>{formatCryptoAlgoSizingLine(props.report.config)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="crypto-algo-optimize-report-section">
        <h3 class="sim-analytics-section-title">
          Perf Crypto Algo sim
          <span class="sim-analytics-category-scope"> · par close_reason</span>
        </h3>
        <CloseReasonBars rows={props.report.byCloseReason} />
        <table class="data-table crypto-algo-optimize-report-table">
          <thead>
            <tr>
              <th>Close</th>
              <th>N</th>
              <th>Total</th>
              <th>Moy.</th>
              <th>Wins</th>
              <th>Durée moy.</th>
              <th>Peak moy.</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.report.byCloseReason}>
              {(row) => (
                <tr>
                  <td>{row.closeReason}</td>
                  <td>{row.count}</td>
                  <td class={pnlClass(row.sumPnl)}>{formatPnlAmount(row.sumPnl, true)}</td>
                  <td class={pnlClass(row.avgPnl)}>{formatPnlAmount(row.avgPnl, true)}</td>
                  <td>{row.wins}</td>
                  <td>
                    {row.avgDurationSec != null ? `${Math.round(row.avgDurationSec)}s` : '—'}
                  </td>
                  <td>{row.avgPeakPct != null ? `${row.avgPeakPct}%` : '—'}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>

      <section class="crypto-algo-optimize-report-section">
        <h3 class="sim-analytics-section-title">
          Surveillance marché
          <span class="sim-analytics-category-scope"> · positions algo sim</span>
        </h3>
        <p class="form-hint">
          Ticks position : {props.report.tickCoverage.closedWithTicks}/
          {props.report.tickCoverage.closedTotal} fermées
          {props.report.tickCoverage.avgTicksWhenPresent != null
            ? ` · ~${props.report.tickCoverage.avgTicksWhenPresent} ticks/pos`
            : ''}
        </p>
        <Show when={props.report.exitAttempts.length > 0}>
          <table class="data-table crypto-algo-optimize-report-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Close</th>
                <th>Block / error</th>
                <th>N</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.report.exitAttempts}>
                {(row) => (
                  <tr>
                    <td>{row.kind}</td>
                    <td>{row.closeReason}</td>
                    <td>{row.blockReason ?? row.error ?? '—'}</td>
                    <td>{row.count}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>

      <section class="crypto-algo-optimize-report-section">
        <h3 class="sim-analytics-section-title">
          Giveback SL
          <span class="sim-analytics-category-scope"> · positions algo sim fermées en SL</span>
        </h3>
        <table class="data-table crypto-algo-optimize-report-table">
          <thead>
            <tr>
              <th>Peak pendant trade</th>
              <th>N</th>
              <th>PnL total</th>
              <th>PnL moy.</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.report.slPeakBuckets}>
              {(row) => (
                <tr>
                  <td>{peakBucketLabel(row.bucket)}</td>
                  <td>{row.count}</td>
                  <td class={pnlClass(row.sumPnl)}>{formatPnlAmount(row.sumPnl, true)}</td>
                  <td class={pnlClass(row.avgPnl)}>{formatPnlAmount(row.avgPnl, true)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <p class="form-hint">
          Whipsaw (SL · peak ≥ 30 %) : {props.report.whipsaw.count} ·{' '}
          {formatPnlAmount(props.report.whipsaw.sumPnl, true)} · Trailing opp. (peak ≥ 20 %) :{' '}
          {props.report.trailingOpportunity.count} ·{' '}
          {formatPnlAmount(props.report.trailingOpportunity.sumPnl, true)}
        </p>
      </section>

      <section class="crypto-algo-optimize-report-section">
        <h3 class="sim-analytics-section-title">
          Entrées & assets
          <span class="sim-analytics-category-scope"> · algo sim uniquement</span>
        </h3>
        <table class="data-table crypto-algo-optimize-report-table">
          <thead>
            <tr>
              <th>Entry bucket</th>
              <th>N</th>
              <th>PnL</th>
              <th>SL %</th>
              <th>Red win %</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.report.entryBuckets}>
              {(row) => (
                <tr>
                  <td>{entryBucketLabel(row.bucket)}</td>
                  <td>{row.count}</td>
                  <td class={pnlClass(row.sumPnl)}>{formatPnlAmount(row.sumPnl, true)}</td>
                  <td>{row.slPct}%</td>
                  <td>{row.redemptionWinPct}%</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <table class="data-table crypto-algo-optimize-report-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Closed</th>
              <th>PnL</th>
              <th>SL</th>
              <th>Red W/L</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.report.byAsset}>
              {(row) => (
                <tr>
                  <td>{row.asset.toUpperCase()}</td>
                  <td>{row.closed}</td>
                  <td class={pnlClass(row.sumPnl)}>{formatPnlAmount(row.sumPnl, true)}</td>
                  <td>{row.slCount}</td>
                  <td>
                    {row.redemptionWins}/{row.redemptionLosses}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>

      <Show when={props.report.recommendedConfig.applicable}>
        <section class="crypto-algo-optimize-report-section crypto-algo-optimize-report-recommended">
          <h3 class="sim-analytics-section-title">
            Paramètres recommandés
            <span class="sim-analytics-category-scope"> · crypto_algo_* · pas copy trading</span>
          </h3>
          <p class="form-hint">
            Dérivés de l’historique ALGO_OPEN sim. Met à jour les tunables Crypto Algo dans
            risk_config — sans toucher aux réglages copy (<code>sim_sl_*</code>, etc.).
          </p>
          <table class="data-table crypto-algo-optimize-report-table">
            <thead>
              <tr>
                <th>Paramètre</th>
                <th>Actuel</th>
                <th>Recommandé</th>
                <th>Raison</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.report.recommendedConfig.changes}>
                {(change) => (
                  <tr>
                    <td>{change.label}</td>
                    <td>{change.from}</td>
                    <td>{change.to}</td>
                    <td>{change.reason}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={props.onApplyRecommended}>
            <div class="crypto-algo-optimize-report-apply-row">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={props.applying}
                onClick={() => props.onApplyRecommended?.()}
              >
                {props.applying ? 'Application…' : 'Appliquer les paramètres recommandés'}
              </button>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={props.report.levers.length > 0}>
        <section class="crypto-algo-optimize-report-section">
          <h3 class="sim-analytics-section-title">
            Leviers d’optimisation
            <span class="sim-analytics-category-scope"> · analyse algo sim</span>
          </h3>
          <ul class="crypto-algo-optimize-report-levers">
            <For each={props.report.levers}>
              {(lever) => (
                <li class="crypto-algo-optimize-report-lever">
                  <span
                    class={`crypto-algo-optimize-report-priority priority-${lever.priority.toLowerCase()}`}
                  >
                    {lever.priority}
                  </span>
                  <div>
                    <strong>{lever.title}</strong>
                    <p class="form-hint">{lever.detail}</p>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
