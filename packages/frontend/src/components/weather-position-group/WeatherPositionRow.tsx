import { Show } from 'solid-js';
import type { WeatherPosition } from '../../hooks/useWeatherAlgoPositions';
import { formatShortDateTime, formatTimeAgo } from '../../lib/date';
import {
  formatPnlAmount,
  formatPnlPercent,
  pnlClass as genericPnlClass,
  pnlPercent,
} from '../../lib/position';
import {
  formatBucketLabel,
  isNeverOpenedCancelled,
  weatherHistoryCloseReasonLabel,
  weatherStrategyLabel,
  type WeatherBucketBounds,
} from '../../lib/weather-position';
import { WeatherPositionMetric } from './WeatherPositionMetric';
import type { ClosePositionHandler, OpenChartHandler } from './types';

interface WeatherPositionRowProps {
  pos: WeatherPosition;
  onOpenChart: OpenChartHandler;
  onClose?: ClosePositionHandler;
}

export function WeatherPositionRow(props: WeatherPositionRowProps) {
  const pos = props.pos;
  const isOpen = pos.status === 'open';
  const isCancelled = pos.status === 'cancelled';
  const isFailedOpen = isNeverOpenedCancelled(pos);
  const wf = pos.weatherForecast;
  const invested = isFailedOpen
    ? 0
    : isOpen
      ? pos.quantity * pos.entryPrice
      : pos.entryInvestedAmount != null && pos.entryInvestedAmount > 0
        ? pos.entryInvestedAmount
        : pos.quantity * pos.entryPrice;
  const pnl = isOpen ? pos.unrealizedPnl : pos.realizedPnl;
  const pct = isFailedOpen ? undefined : pnlPercent(pnl, invested);
  const qty = isFailedOpen
    ? 0
    : isOpen
      ? pos.quantity
      : pos.quantity <= 0 && pos.entryQuantityFilled != null && pos.entryQuantityFilled > 0
        ? pos.entryQuantityFilled
        : pos.quantity;
  const qtyLabel = isFailedOpen ? '—' : qty.toFixed(4);
  const investedLabel = isFailedOpen ? '—' : invested.toFixed(2) + ' pUSD';
  const entryPriceLabel = isFailedOpen ? '—' : pos.entryPrice.toFixed(3);
  const closeReasonLabel = weatherHistoryCloseReasonLabel(pos.closeReason);
  const dateLabel = isFailedOpen
    ? 'Échec le'
    : isOpen
      ? 'Ouvert le'
      : isCancelled
        ? 'Annulé le'
        : 'Clôturé le';
  const dateValue = isOpen ? pos.openedAt : pos.closedAt;
  const bidValue =
    isOpen && pos.executableBidVwap != null && pos.executableBidVwap > 0
      ? pos.executableBidVwap.toFixed(3)
      : undefined;
  const statusBadge = isFailedOpen ? 'Entrée échouée' : isCancelled ? 'Annulée' : null;
  const cashPnl = isOpen ? (pos.executableCashPnl ?? null) : null;
  const cashPnlLabel = cashPnl != null ? formatPnlAmount(cashPnl, true) : undefined;
  const cashPnlClass = cashPnl != null ? genericPnlClass(cashPnl) : '';
  return (
    <div class="weather-history-pos-item">
      <div class="weather-history-pos-item__row">
        <span class="algo-badge">{pos.outcome}</span>
        <span class={`algo-mode-badge ${pos.mode}`}>
          {pos.mode === 'real' ? 'Réel' : pos.mode === 'sim' ? 'Sim' : pos.mode}
        </span>
        <Show when={statusBadge}>
          <span class="algo-badge">{statusBadge}</span>
        </Show>
        <Show when={weatherStrategyLabel(pos.strategyId)}>
          {(label) => <span class="algo-strategy-badge">{label()}</span>}
        </Show>
        <Show when={!isFailedOpen}>
          <span class={`text-mono ${genericPnlClass(pnl)}`}>
            {formatPnlAmount(pnl, true)}
            <Show when={pct != null}>
              <span class="algo-pnl-pct"> ({formatPnlPercent(pct)})</span>
            </Show>
          </span>
        </Show>
      </div>
      <div class="weather-history-pos-item__row">
        <WeatherPositionMetric
          label="Bucket"
          value={formatBucketLabel(
            wf?.entryBucketComparison ?? null,
            (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
            wf?.unit ?? null,
          )}
        />
        <WeatherPositionMetric
          label="Qté"
          className="text-mono"
          value={qtyLabel}
        />
        <WeatherPositionMetric
          label="Mise investie"
          className="text-mono"
          value={investedLabel}
        />
        <WeatherPositionMetric
          label="Prix entrée"
          className="text-mono"
          value={entryPriceLabel}
        />
        <WeatherPositionMetric
          label="PnL cash"
          className={`text-mono ${cashPnlClass}`}
          value={cashPnlLabel}
        />
        <WeatherPositionMetric
          label="Bid actuel"
          className="text-mono"
          value={bidValue}
        />
        <WeatherPositionMetric
          label={dateLabel}
          className="text-mono text-sm"
          value={formatShortDateTime(dateValue)}
        />
        <WeatherPositionMetric
          label="Pris il y a"
          className="text-mono text-sm"
          value={isOpen && pos.openedAt ? formatTimeAgo(pos.openedAt) : undefined}
        />
        <WeatherPositionMetric
          label="Raison"
          className="text-mono text-sm badge badge-close-reason"
          value={closeReasonLabel}
        />
      </div>
      <div class="weather-history-pos-item__row">
        <Show when={pos.marketUrl}>
          <a
            class="btn btn-sm btn-ghost weather-position-card__link"
            href={pos.marketUrl!}
            target="_blank"
            rel="noopener noreferrer"
          >
            Voir le marché
          </a>
        </Show>
        <button
          type="button"
          class="btn btn-sm btn-ghost weather-position-card__link"
          onClick={() => props.onOpenChart(pos)}
        >
          Voir graph
        </button>
        <Show when={isOpen && props.onClose}>
          <button
            type="button"
            class="btn btn-sm btn-ghost weather-position-card__close"
            onClick={() => props.onClose!(pos.id)}
          >
            Fermer
          </button>
        </Show>
      </div>
    </div>
  );
}