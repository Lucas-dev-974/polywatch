import { Show, createMemo, type Accessor } from 'solid-js';
import { getTimeRemaining, getTimeUntilStart } from '../lib/markets-list';
import { displayAlgoSymbol, formatAlgoPriceCents } from '../lib/algo-market-display';
import { Icon } from './Icon';
import { AlgoMarketChartTrigger } from './AlgoMarketChartTrigger';
export type AlgoMarketPhase = 'live' | 'future';

export interface AlgoMarketPrice {
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  enabled: boolean;
  phase: AlgoMarketPhase;
  upPrice: number | null;
  downPrice: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  icon: string | null;
  startDate: string | null;
  endDate: string | null;
  resolved: boolean;
  closed: boolean;
}

export interface AlgoMarketsPricesResponse {
  live: AlgoMarketPrice[];
  future: AlgoMarketPrice[];
}

export interface AlgoMarketCardProps {
  market: AlgoMarketPrice;
  now: Accessor<number>;
  onToggleEnabled?: (enabled: boolean) => void;
  onRemove?: () => void;
}

function formatVolume(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}

function formatTimer(totalMs: number): string {
  if (totalMs > 86_400_000) {
    return `${Math.floor(totalMs / 86_400_000)}j`;
  }
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function TimerLabel(props: {
  phase: AlgoMarketPhase;
  endDate: string | null;
  startDate: string | null;
  resolved: boolean;
  closed: boolean;
  now: Accessor<number>;
}) {
  const state = createMemo(() => {
    const tick = props.now();

    if (props.phase === 'live') {
      if (!props.endDate || props.resolved || props.closed) return null;
      const remaining = getTimeRemaining(props.endDate, tick);
      if (!remaining) return null;
      if (remaining.expired) {
        return { class: 'expired', text: 'Fin', title: 'Terminé' };
      }
      return {
        class: 'live',
        text: formatTimer(remaining.totalMs),
        title: 'Temps restant',
      };
    }

    if (!props.startDate) return null;
    const untilStart = getTimeUntilStart(props.startDate, tick);
    if (!untilStart) return null;
    if (untilStart.expired) {
      return { class: 'soon', text: '→', title: 'Bientôt live' };
    }
    return {
      class: 'future',
      text: `+${formatTimer(untilStart.totalMs)}`,
      title: 'Début dans',
    };
  });

  return (
    <Show when={state()}>
      {(s) => (
        <span class={`algo-market-timer ${s().class}`} title={s().title}>
          {s().text}
        </span>
      )}
    </Show>
  );
}

export function AlgoMarketCard(props: AlgoMarketCardProps) {
  const mp = () => props.market;
  const isLive = () => mp().phase === 'live';
  const hasActions = () => isLive() && (props.onToggleEnabled || props.onRemove);

  return (
    <div
      class={`algo-market-card ${isLive() ? 'algo-market-card-live' : 'algo-market-card-future'}`}
      title={mp().question ?? mp().conditionId}
    >
      <div class="algo-market-card-top">
        <Show when={mp().icon}>
          <img class="algo-market-card-icon" src={mp().icon!} alt="" />
        </Show>
        <div class="algo-market-card-identity">
          <span class="algo-market-card-crypto">{displayAlgoSymbol(mp().cryptoSymbol)}</span>
          <span class="algo-market-card-sep">·</span>
          <span class="algo-market-card-interval">{mp().interval ?? '—'}</span>
        </div>
        <span class={`algo-market-phase-badge ${isLive() ? 'live' : 'future'}`}>
          {isLive() ? 'Live' : 'Futur'}
        </span>
        <TimerLabel
          phase={mp().phase}
          endDate={mp().endDate}
          startDate={mp().startDate}
          resolved={mp().resolved}
          closed={mp().closed}
          now={props.now}
        />
      </div>

      <div class="algo-market-card-body">
        <div class="algo-market-card-prices">
          <div class="algo-market-price up">
            <span class="algo-market-price-label">Up</span>
            <span class="algo-market-price-value">{formatAlgoPriceCents(mp().upPrice)}</span>
          </div>
          <div class="algo-market-price-divider" aria-hidden="true" />
          <div class="algo-market-price down">
            <span class="algo-market-price-label">Dn</span>
            <span class="algo-market-price-value">{formatAlgoPriceCents(mp().downPrice)}</span>
          </div>
        </div>
        <div class="algo-market-card-actions">
          <AlgoMarketChartTrigger
            buttonClass="btn btn-ghost btn-sm algo-market-chart-btn"
            conditionId={mp().conditionId}
            cryptoSymbol={mp().cryptoSymbol}
            interval={mp().interval}
            question={mp().question}
            marketStartAt={mp().startDate}
            marketEndAt={mp().endDate}
          />
          <Show when={hasActions()}>
            <Show when={props.onToggleEnabled}>
              <label class="toggle-switch toggle-switch-sm">
                <input
                  type="checkbox"
                  checked={mp().enabled}
                  onChange={(e) => props.onToggleEnabled?.(e.currentTarget.checked)}
                />
                <span class="toggle-track" />
              </label>
            </Show>
            <Show when={props.onRemove}>
              <button
                class="btn btn-ghost btn-sm btn-danger algo-market-card-remove"
                onClick={() => props.onRemove?.()}
                title="Supprimer"
              >
                <Icon name="trash" />
              </button>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={isLive() && mp().volume24hr != null}>
        <div class="algo-market-card-meta">Vol {formatVolume(mp().volume24hr)}</div>
      </Show>

    </div>
  );
}
