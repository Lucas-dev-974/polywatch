import { Show } from 'solid-js';
import type { MarketOrderSizeInfo } from '../../hooks/useMarketOrderSize';

function formatShares(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3);
}

export interface MarketChartMosMetaProps {
  loading: boolean;
  error: string | null;
  info: MarketOrderSizeInfo | null;
  /** Position quantity in shares (open qty or filled entry qty). */
  positionQuantity?: number | null;
}

function displayMosShares(info: MarketOrderSizeInfo): number {
  return info.source === 'fallback' ? info.effectiveEntryMos : info.minOrderShares;
}

export function MarketChartMosMeta(props: MarketChartMosMetaProps) {
  const belowMos = () => {
    const qty = props.positionQuantity;
    const info = props.info;
    if (qty == null || qty <= 0 || info == null) return false;
    return qty < displayMosShares(info);
  };

  return (
    <Show when={props.loading || props.error || props.info}>
      <div class="market-chart-mos" data-below-mos={belowMos() ? 'true' : undefined}>
        <Show
          when={!props.loading && !props.error && props.info}
          fallback={
            <span class="market-chart-badge market-chart-badge-mos">
              {props.loading
                ? 'MOS…'
                : props.error
                  ? 'MOS : indisponible'
                  : null}
            </span>
          }
        >
          {(mos) => (
            <>
              <span
                class="market-chart-badge market-chart-badge-mos"
                title="Taille minimale d'ordre Polymarket (achat et vente sur ce token)"
              >
                MOS achat / vente : {formatShares(displayMosShares(mos()))} shares
                {mos().source === 'fallback' ? ' (estimé)' : ''}
              </span>
              <Show when={props.positionQuantity != null && props.positionQuantity > 0}>
                <span
                  class={`market-chart-badge market-chart-badge-position-qty${belowMos() ? ' market-chart-badge-warn' : ''}`}
                  title={
                    belowMos()
                      ? 'Quantité de la position inférieure au MOS — sortie SL/vente bloquée côté CLOB'
                      : 'Quantité de la position'
                  }
                >
                  Position : {formatShares(props.positionQuantity!)} shares
                  {belowMos() ? ' · sous MOS' : ''}
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}
