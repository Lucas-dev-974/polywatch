import { createSignal, Show, createEffect } from 'solid-js';

import { Dialog } from './Dialog';
import { TimeSeriesLineChart } from './TimeSeriesLineChart';
import {
  fetchMarketMetrics,
  formatPrice,
  formatSpread,
  type MarketMetrics,
  type MarketTick,
} from '../lib/market';
import {
  formatAdaptiveAmount,
  marketLabel,
  type Position,
} from '../lib/position';
import { isCryptoUpDownMarket } from '../lib/markets-list';
import type { MarketListItemDto } from '@polywatch/core/market-list';

interface Props {
  open: boolean;
  onClose: () => void;
  pos: Position;
  liveTick: () => MarketTick | undefined;
  item?: MarketListItemDto;
}

function MetricRow(props: { label: string; value: string; hint?: string }) {
  return (
    <div class="market-metric-row">
      <span class="market-metric-label" title={props.hint}>{props.label}</span>
      <span class="market-metric-value text-mono">{props.value}</span>
    </div>
  );
}

function PriceHistoryChart(props: { points: { t: number; p: number }[] }) {
  const width = 320;
  const height = 80;
  const points = () => props.points;
  const path = () => {
    const pts = points();
    if (pts.length < 2) return '';
    const minT = pts[0]!.t;
    const maxT = pts[pts.length - 1]!.t;
    const prices = pts.map((p) => p.p);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const rangeP = maxP - minP || 0.01;
    const rangeT = maxT - minT || 1;
    return pts
      .map((pt, i) => {
        const x = ((pt.t - minT) / rangeT) * width;
        const y = height - ((pt.p - minP) / rangeP) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div class="market-price-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Historique de prix"
      >
        <path d={path()} fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </div>
  );
}

export function MarketMetricsPanel(props: Props) {
  const [metrics, setMetrics] = createSignal<MarketMetrics | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const item = () => props.item;
  const isCryptoChart = () =>
    item() != null && isCryptoUpDownMarket(item()!);

  async function load(includeHistory: boolean) {
    setLoading(true);
    setError(null);
    try {
      const marketItem = item();
      const data = await fetchMarketMetrics(props.pos.conditionId, {
        assetId: props.pos.assetId,
        includeHistory,
        cryptoSymbol: isCryptoChart() ? marketItem?.cryptoSymbol ?? undefined : undefined,
        interval: isCryptoChart() ? marketItem?.interval ?? null : null,
      });
      setMetrics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (props.open) void load(true);
  });

  const tick = () => props.liveTick();

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Métriques marché"
      titleId="market-metrics-dialog-title"
      class="dialog-settings dialog-metrics"
      bodyClass="dialog-body-metrics"
    >
      <p class="market-metrics-subtitle">{marketLabel(props.pos)}</p>

      <Show when={metrics()}>
        {(m) => (
          <Show
            when={isCryptoChart() && m().cryptoSpotHistory && m().cryptoSpotHistory!.length > 1}
          >
            <section class="market-metrics-section market-metrics-chart-section market-metrics-chart-hero">
              <TimeSeriesLineChart
                points={m().cryptoSpotHistory!.map((pt) => ({
                  t: pt.t,
                  equity: pt.p,
                }))}
                title={`Cours spot ${item()?.cryptoSymbol ?? 'crypto'}`}
                ariaLabel={`Cours spot ${item()?.cryptoSymbol ?? 'crypto'}`}
                tone="sim"
                rangeSuffix="USD"
                formatY={(v) => `$${v.toFixed(2)}`}
                class="market-crypto-chart"
              />
            </section>
          </Show>
        )}
      </Show>

      <section class="market-metrics-section">
        <h3 class="market-metrics-heading">Live (CLOB)</h3>
        <MetricRow
          label="Best bid"
          value={formatPrice(tick()?.bestBid)}
          hint="Meilleur prix acheteur"
        />
        <MetricRow
          label="Best ask"
          value={formatPrice(tick()?.bestAsk)}
          hint="Meilleur prix vendeur"
        />
        <MetricRow
          label="Spread top"
          value={formatSpread(tick()?.spreadTop)}
          hint="Écart best ask − best bid"
        />
        <MetricRow
          label="Spread exécutable"
          value={formatSpread(tick()?.spreadExecutable)}
          hint="Écart VWAP ask − bid pour votre quantité"
        />
        <MetricRow
          label="Dernier trade"
          value={formatPrice(tick()?.lastTradePrice)}
          hint="Dernier prix exécuté — distinct du mark PnL"
        />
      </section>

      <Show when={loading()}>
        <p class="form-hint">Chargement des métriques…</p>
      </Show>
      <Show when={error()}>
        <p class="form-hint">{error()}</p>
      </Show>

      <Show when={metrics()}>
        {(m) => (
          <>
            <section class="market-metrics-section">
              <h3 class="market-metrics-heading">Contexte (Gamma / Data API)</h3>
              <MetricRow
                label="Volume 24h"
                value={
                  m().volume24hr != null
                    ? formatAdaptiveAmount(m().volume24hr!)
                    : '—'
                }
              />
              <MetricRow
                label="Liquidité CLOB"
                value={
                  m().liquidityClob != null
                    ? formatAdaptiveAmount(m().liquidityClob!)
                    : '—'
                }
              />
              <MetricRow
                label="Open interest"
                value={
                  m().openInterest != null
                    ? formatAdaptiveAmount(m().openInterest!)
                    : '—'
                }
              />
              <Show when={m().outcomePrices?.length}>
                <MetricRow
                  label="Prix outcomes"
                  value={(m().outcomePrices ?? [])
                    .map((o) => `${o.outcome} ${formatPrice(o.price)}`)
                    .join(' · ')}
                />
              </Show>
              <p class="form-hint">
                Source REST · {new Date(m().fetchedAt).toLocaleString('fr-FR')}
              </p>
            </section>

            <Show when={m().priceHistory && m().priceHistory!.length > 1}>
              <section class="market-metrics-section">
                <h3 class="market-metrics-heading">Historique prix outcome</h3>
                <PriceHistoryChart points={m().priceHistory!} />
              </section>
            </Show>

            <Show when={m().recentTrades && m().recentTrades!.length > 0}>
              <section class="market-metrics-section">
                <h3 class="market-metrics-heading">Derniers trades</h3>
                <ul class="market-trades-list">
                  {(m().recentTrades ?? []).slice(0, 10).map((t) => (
                    <li class="market-trade-row text-mono">
                      {new Date(t.timestamp).toLocaleTimeString('fr-FR')}{' '}
                      {formatPrice(t.price)} × {formatAdaptiveAmount(t.size)}
                      {t.side ? ` (${t.side})` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            </Show>
          </>
        )}
      </Show>
    </Dialog>
  );
}
