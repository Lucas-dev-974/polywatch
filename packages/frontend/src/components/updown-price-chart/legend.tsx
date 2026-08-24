import { For, Show } from 'solid-js';
import type { AlgoPriceTickMetrics } from '../../lib/market-chart';
import {
  fmtLiquidityStatus,
  liquidityStatusClass,
  resolveMarketLiquidityStatus,
} from '../../lib/market-chart-debug-format';
import {
  UPDOWN_CHART_CONFIG,
  type PriceMode,
} from '../../lib/updown-price-chart';
import type { ChartOverlayToggles } from '../../lib/updown-chart-overlays';

export const OVERLAY_TOGGLE_LABELS: Record<keyof ChartOverlayToggles, string> = {
  showBidAskBands: 'Bandes bid/ask',
  showSignals: 'Signaux',
  showPriceGap: 'Gap',
  showIlliquid: 'Illiquidité',
  showPositionLevels: 'Entrée / SL / TP',
  showPositionExecutionPrice: "Prix d'exécution",
  showPositionExitPrice: 'Prix de sortie',
  showSlExitAttempts: 'Tentatives SL',
};

export const OVERLAY_TOGGLE_TITLES: Record<keyof ChartOverlayToggles, string> = {
  showBidAskBands:
    'Enveloppe entre le meilleur bid et le meilleur ask (spread) pour chaque outcome',
  showSignals:
    'Triangles aux instants où la stratégie a émis un signal d’entrée (YES/NO + confiance), dans les 5 dernières secondes du tick',
  showPriceGap:
    'Écart de cohérence binaire |Up + Down − 1| > 3 ¢ — le marché s’éloigne d’un livre parfait',
  showIlliquid: 'Zones où le carnet est illiquide ou partiellement liquable',
  showPositionLevels: 'Lignes horizontales d’entrée, stop-loss et take-profit',
  showPositionExecutionPrice: 'Marqueur du prix d’exécution à l’ouverture',
  showPositionExitPrice: 'Marqueur du prix de sortie à la clôture',
  showSlExitAttempts: 'Tentatives de sortie SL non exécutées',
};

export function LiquidityBadge(props: {
  label: string;
  status: AlgoPriceTickMetrics['upLiquidityStatus'];
}) {
  return (
    <span class={`updown-chart-liquidity-badge ${liquidityStatusClass(props.status)}`}>
      {props.label}: {fmtLiquidityStatus(props.status)}
    </span>
  );
}

interface LegendProps {
  toggles: ChartOverlayToggles;
  onToggle: (key: keyof ChartOverlayToggles) => void;
  metricsAvailable: boolean;
  activeMetrics: () => AlgoPriceTickMetrics | undefined;
  hasPositionLevels: boolean;
  hasExitPrice: boolean;
  hasSlExitAttempts: boolean;
  hasDownData: boolean;
  side0Label: string;
  side1Label: string;
  priceMode: PriceMode;
  onPriceModeChange: (mode: PriceMode) => void;
}

export function UpDownChartLegend(props: LegendProps) {
  const { up, down } = UPDOWN_CHART_CONFIG.colors;
  const overlayKeys = Object.keys(OVERLAY_TOGGLE_LABELS).filter((k) => {
    const key = k as keyof ChartOverlayToggles;
    if (key === 'showPositionLevels' || key === 'showPositionExecutionPrice') {
      return props.hasPositionLevels;
    }
    if (key === 'showPositionExitPrice') {
      return props.hasExitPrice;
    }
    if (key === 'showSlExitAttempts') {
      return props.hasSlExitAttempts;
    }
    return true;
  }) as (keyof ChartOverlayToggles)[];

  return (
    <div class="updown-chart-toolbar">
      <div class="updown-chart-toolbar-row updown-chart-toolbar-primary">
        <div class="updown-chart-legend-items">
          <span class="updown-chart-legend-item">
            <span class="updown-chart-legend-swatch" style={{ background: up }} />
            {props.side0Label}
          </span>
          <Show when={props.hasDownData}>
            <span class="updown-chart-legend-item">
              <span class="updown-chart-legend-swatch" style={{ background: down }} />
              {props.side1Label}
            </span>
          </Show>
        </div>
        <Show when={props.metricsAvailable && props.activeMetrics()}>
          {(m) => (
            <div class="updown-chart-liquidity-row">
              <Show when={props.hasDownData}>
                <LiquidityBadge label={props.side0Label} status={m().upLiquidityStatus} />
                <LiquidityBadge label={props.side1Label} status={m().downLiquidityStatus} />
              </Show>
              <Show when={!props.hasDownData}>
                <LiquidityBadge label="Marché" status={m().upLiquidityStatus} />
              </Show>
              <Show when={props.hasDownData}>
                <LiquidityBadge
                  label="Marché"
                  status={resolveMarketLiquidityStatus(
                    m().upLiquidityStatus,
                    m().downLiquidityStatus,
                  )}
                />
              </Show>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.metricsAvailable}>
        <div class="updown-chart-toolbar-row updown-chart-toolbar-overlays">
          <For each={overlayKeys}>
            {(key) => (
              <button
                type="button"
                class="updown-chart-toggle-chip"
                classList={{ 'is-active': props.toggles[key] }}
                title={OVERLAY_TOGGLE_TITLES[key]}
                onClick={() => props.onToggle(key)}
              >
                {OVERLAY_TOGGLE_LABELS[key]}
              </button>
            )}
          </For>
        </div>
        <div class="updown-chart-toolbar-row updown-chart-toolbar-price-mode">
          <span class="updown-chart-price-mode-label">Prix :</span>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'mid' }}
            onClick={() => props.onPriceModeChange('mid')}
          >
            Mid
          </button>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'bid' }}
            onClick={() => props.onPriceModeChange('bid')}
          >
            Bid
          </button>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'ask' }}
            onClick={() => props.onPriceModeChange('ask')}
          >
            Ask
          </button>
        </div>
      </Show>
    </div>
  );
}
