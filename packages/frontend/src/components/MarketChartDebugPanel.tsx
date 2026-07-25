import { createMemo, For, Show } from 'solid-js';
import type { AlgoPriceTickMetrics, OutcomeSideLabels, UpDownPricePoint } from '../lib/market-chart';
import { computeChartMetricSummaries } from '../lib/market-chart';
import {
  DEBUG_EMPTY,
  debugSpreadValueClass,
  debugWsValueClass,
  fmtDebugBool,
  fmtDebugGap,
  fmtDebugMs,
  fmtDebugPct,
  fmtDebugSeconds,
  fmtDebugUsd,
  fmtLiquidityStatus,
  isDebugEmpty,
  resolveMarketLiquidityStatus,
} from '../lib/market-chart-debug-format';
import { pnlClass } from '../lib/position';
import { formatUpDownPriceCents } from '../lib/updown-price-chart';
import {
  exitAttemptBreakdownRows,
  formatExitAttemptDetail,
  summarizeExitAttempts,
  type ExitAttemptEvent,
} from '../lib/exit-attempts';

export interface MarketChartDebugPanelProps {
  points: UpDownPricePoint[];
  hoverPoint: () => UpDownPricePoint | null;
  isCryptoUpDown: boolean;
  entryPrice?: number | null;
  outcomeLabels?: OutcomeSideLabels | null;
  /** Journal attempts when opened from a position; undefined = no position context. */
  exitAttempts?: ExitAttemptEvent[];
  exitAttemptsError?: string | null;
}

interface DebugField {
  label: string;
  value: string;
  valueClass?: string;
}

function DebugCell(props: DebugField) {
  return (
    <div class="market-chart-debug-section">
      <span class="market-chart-debug-label detail-label">{props.label}</span>
      <span
        class={`market-chart-debug-value detail-value mono${props.valueClass ? ` ${props.valueClass}` : ''}${isDebugEmpty(props.value) ? ' market-chart-debug-empty' : ''}`}
      >
        {props.value}
      </span>
    </div>
  );
}

function DebugSection(props: { title: string; fields: DebugField[] }) {
  return (
    <div class="market-chart-debug-block">
      <h5 class="market-chart-debug-section-title">{props.title}</h5>
      <div class="market-chart-debug-grid">
        <For each={props.fields}>
          {(field) => (
            <DebugCell
              label={field.label}
              value={field.value}
              valueClass={field.valueClass}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function formatSignal(metrics: AlgoPriceTickMetrics | undefined): string {
  if (!metrics?.lastSignalOutcome) return DEBUG_EMPTY;
  const confidence =
    metrics.lastSignalConfidence != null
      ? ` (${(metrics.lastSignalConfidence * 100).toFixed(0)}%)`
      : '';
  return `${metrics.lastSignalOutcome}${confidence}`;
}

function formatAttemptAge(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DEBUG_EMPTY;
  return fmtDebugMs(Date.now() - t);
}

export function MarketChartDebugPanel(props: MarketChartDebugPanelProps) {
  const activePoint = createMemo(
    () => props.hoverPoint() ?? props.points[props.points.length - 1] ?? null,
  );
  const summaries = createMemo(() => computeChartMetricSummaries(props.points));
  const metrics = () => activePoint()?.metrics;

  const exitAttemptFields = createMemo((): DebugField[] | null => {
    if (props.exitAttempts === undefined) return null;
    if (props.exitAttemptsError) {
      return [
        {
          label: 'Journal',
          value: 'indisponible',
          valueClass: 'market-chart-debug-warn',
        },
      ];
    }
    const summary = summarizeExitAttempts(props.exitAttempts);
    const fields: DebugField[] = [
      {
        label: 'Observations bloquées',
        value: String(summary.emitBlocked),
      },
      {
        label: 'Échecs CLOB',
        value: String(summary.executionFailed),
      },
    ];
    for (const row of exitAttemptBreakdownRows(summary.byCloseReason)) {
      fields.push({ label: row.reason, value: String(row.count) });
    }
    if (summary.last) {
      fields.push({
        label: 'Dernière',
        value: `${formatExitAttemptDetail(summary.last)} · ${formatAttemptAge(summary.last.createdAt)}`,
      });
    }
    return fields;
  });

  const executionFields = createMemo((): DebugField[] => {
    const m = metrics();
    const side0 = props.outcomeLabels?.side0 ?? 'Up';
    const side1 = props.outcomeLabels?.side1 ?? 'Down';
    if (!props.isCryptoUpDown) {
      return [
        { label: 'Spread', value: fmtDebugPct(m?.upSpreadPct), valueClass: debugSpreadValueClass(m?.upSpreadPct) },
        { label: 'Dernier échange', value: formatUpDownPriceCents(m?.upLastTradePrice ?? null) },
        { label: 'Staleness', value: fmtDebugMs(m?.bookStalenessMs) },
        { label: 'WS healthy', value: fmtDebugBool(m?.wsHealthy), valueClass: debugWsValueClass(m?.wsHealthy) },
        { label: 'Fin marché', value: fmtDebugSeconds(m?.secondsUntilEnd) },
      ];
    }
    return [
      {
        label: `Spread ${side0}`,
        value: fmtDebugPct(m?.upSpreadPct),
        valueClass: debugSpreadValueClass(m?.upSpreadPct),
      },
      {
        label: `Spread ${side1}`,
        value: fmtDebugPct(m?.downSpreadPct),
        valueClass: debugSpreadValueClass(m?.downSpreadPct),
      },
      {
        label: `VWAP ask ${side0}`,
        value: formatUpDownPriceCents(m?.upAskVwap ?? null),
      },
      {
        label: `VWAP ask ${side1}`,
        value: formatUpDownPriceCents(m?.downAskVwap ?? null),
      },
      {
        label: `Liquidité ${side0}`,
        value: fmtLiquidityStatus(m?.upLiquidityStatus),
      },
      {
        label: `Liquidité ${side1}`,
        value: fmtLiquidityStatus(m?.downLiquidityStatus),
      },
      {
        label: 'Liquidité marché',
        value: fmtLiquidityStatus(
          resolveMarketLiquidityStatus(
            m?.upLiquidityStatus,
            m?.downLiquidityStatus,
          ),
        ),
      },
      { label: 'Price gap', value: fmtDebugGap(m?.priceGap) },
      { label: 'Staleness', value: fmtDebugMs(m?.bookStalenessMs) },
      {
        label: 'WS healthy',
        value: fmtDebugBool(m?.wsHealthy),
        valueClass: debugWsValueClass(m?.wsHealthy),
      },
      {
        label: 'Fin marché',
        value: fmtDebugSeconds(m?.secondsUntilEnd),
      },
    ];
  });

  const strategyFields = createMemo((): DebugField[] => {
    const m = metrics();
    const side0 = props.outcomeLabels?.side0 ?? 'Up';
    const side1 = props.outcomeLabels?.side1 ?? 'Down';
    const unrealizedPnl =
      m?.unrealizedPnl != null && Number.isFinite(m.unrealizedPnl)
        ? m.unrealizedPnl
        : undefined;

    if (!props.isCryptoUpDown) {
      return [
        { label: 'Positions ouvertes', value: String(m?.openPositionsCount ?? 0) },
        { label: 'Prix entrée (ask)', value: formatUpDownPriceCents(props.entryPrice ?? null) },
        { label: 'Exposure', value: fmtDebugUsd(m?.openExposureUsd) },
        { label: 'PnL latent', value: fmtDebugUsd(m?.unrealizedPnl), valueClass: pnlClass(unrealizedPnl) },
        { label: 'Dernier signal', value: formatSignal(m) },
        { label: 'Abstention', value: m?.lastAbstainReason ?? DEBUG_EMPTY },
        { label: 'Stratégie', value: m?.lastSignalStrategyId ?? DEBUG_EMPTY },
        { label: 'Âge signal', value: fmtDebugMs(m?.signalAgeMs) },
      ];
    }

    return [
      {
        label: 'Positions ouvertes',
        value: String(m?.openPositionsCount ?? 0),
      },
      { label: 'Prix entrée (ask)', value: formatUpDownPriceCents(props.entryPrice ?? null) },
      { label: 'Exposure', value: fmtDebugUsd(m?.openExposureUsd) },
      {
        label: 'PnL latent',
        value: fmtDebugUsd(m?.unrealizedPnl),
        valueClass: pnlClass(unrealizedPnl),
      },
      { label: 'Dernier signal', value: formatSignal(m) },
      {
        label: 'Abstention',
        value: m?.lastAbstainReason ?? DEBUG_EMPTY,
      },
      {
        label: 'Stratégie',
        value: m?.lastSignalStrategyId ?? DEBUG_EMPTY,
      },
      { label: 'Âge signal', value: fmtDebugMs(m?.signalAgeMs) },
      {
        label: `Δ ${side0} 1s`,
        value:
          m?.upDelta1s != null
            ? formatUpDownPriceCents(m.upDelta1s)
            : DEBUG_EMPTY,
      },
      {
        label: `Δ ${side1} 1s`,
        value:
          m?.downDelta1s != null
            ? formatUpDownPriceCents(m.downDelta1s)
            : DEBUG_EMPTY,
      },
    ];
  });

  return (
    <Show when={props.points.length > 0}>
      <div class="market-chart-debug-panel">
        <div class="market-chart-debug-header">
          <h4 class="market-chart-debug-title">Debug & exécution</h4>
          <span class="market-chart-debug-hint">
            ws_healthy = global — staleness = par marché
          </span>
        </div>

        <DebugSection title="Marché & exécution" fields={executionFields()} />
        <Show when={exitAttemptFields()}>
          {(fields) => (
            <DebugSection title="Tentatives de sortie" fields={fields()} />
          )}
        </Show>
        <DebugSection title="Stratégie & positions" fields={strategyFields()} />

        <Show when={summaries().avgUpSpreadPct != null || summaries().maxPriceGap != null}>
          <div class="market-chart-debug-summary">
            <Show when={props.isCryptoUpDown}>
              <span>
                Spread moy. Up: {fmtDebugPct(summaries().avgUpSpreadPct)} — Down:{' '}
                {fmtDebugPct(summaries().avgDownSpreadPct)}
              </span>
            </Show>
            <Show when={!props.isCryptoUpDown}>
              <span>
                Spread moy.: {fmtDebugPct(summaries().avgUpSpreadPct)}
              </span>
            </Show>
            <span>Gap max: {fmtDebugGap(summaries().maxPriceGap)}</span>
          </div>
        </Show>
      </div>
    </Show>
  );
}
