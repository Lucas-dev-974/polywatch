import { Show } from 'solid-js';
import type { WeatherPosition } from '../../hooks/useWeatherAlgoPositions';
import { formatShortDateTime } from '../../lib/date';
import { formatPnlAmount, pnlClass } from '../../lib/position';

interface WeatherPositionChartSummaryProps {
  position: WeatherPosition;
}

/**
 * Résumé d'une position affiché sous le graph du dialog « Voir graph » :
 * outcome, entrée, bid actuel (open) ou sortie / PnL / raison (closed).
 */
export function WeatherPositionChartSummary(props: WeatherPositionChartSummaryProps) {
  const p = () => props.position;
  const bid = (): string | undefined => {
    const v = p().executableBidVwap;
    if (p().status === 'open' && v != null && v > 0) return v.toFixed(3);
    return undefined;
  };
  const exitPrice = (): string => {
    const v = p().exitBidVwap;
    return v != null ? v.toFixed(3) : '—';
  };
  return (
    <div class="weather-position-chart-summary">
      <span>
        Outcome : <strong>{p().outcome}</strong>
      </span>
      <span>
        Entrée : <strong>{p().entryPrice.toFixed(3)}</strong> pUSD
        {p().openedAt ? ` · ${formatShortDateTime(p().openedAt)}` : ''}
      </span>
      <Show when={bid() != null}>
        <span>
          Bid actuel : <strong>{bid()}</strong> pUSD
        </span>
      </Show>
      <Show when={p().status === 'closed'}>
        <span>
          Sortie : <strong>{exitPrice()}</strong> pUSD
          {p().closedAt ? ` · ${formatShortDateTime(p().closedAt)}` : ''}
        </span>
        <span>
          PnL :{' '}
          <strong class={pnlClass(p().realizedPnl)}>
            {formatPnlAmount(p().realizedPnl, true)}
          </strong>
        </span>
        <Show when={p().closeReason}>
          <span>
            Raison : <strong>{p().closeReason}</strong>
          </span>
        </Show>
      </Show>
    </div>
  );
}
