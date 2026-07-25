import { Show } from 'solid-js';
import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import {
  COLLATERAL_TOKEN,
  formatPnlAmount,
  formatPnlPercent,
  pnlClass,
  computeSlDistance,
  type SlDistance,
} from '../../lib/position';
import { formatPrice, formatSpread, type MarketTick } from '../../lib/market';

interface Props {
  amount: number;
  closurePercent: number | undefined;
  triggerPercent: number | undefined;
  mode: string;
  marketTick?: MarketTick;
  slBidPoints?: number | null;
  entryBidVwap?: number;
}

export function OpenPositionRowPnl(props: Props) {
  const tick = () => props.marketTick;

  const slDistance = (): SlDistance => {
    if (!tick()) return computeSlDistance({});
    return computeSlDistance({
      slBidPoints: props.slBidPoints,
      entryBidVwap: props.entryBidVwap,
      currentBid: tick()?.bestBid,
    });
  };

  const slLabel = (): string => {
    const d = slDistance();
    if (!d.active) return '';
    if (d.breached) return 'SL atteint';
    if (d.bidPoints != null) return `SL -${formatPrice(d.bidPoints)} pts`;
    return '';
  };

  const slClass = (): string => {
    const d = slDistance();
    if (!d.active) return '';
    if (d.breached) return 'sl-breached';
    if (d.bidPoints != null && d.bidPoints < 0.02) return 'sl-near';
    return 'sl-safe';
  };

  return (
    <div class="position-row-pnl position-row-pnl-dual">
      <span
        class={`position-row-pnl-amount text-mono ${pnlClass(props.amount)}`}
        title={POSITION_TOOLTIPS.pnlOpenAmount}
      >
        {formatPnlAmount(props.amount, true)} {COLLATERAL_TOKEN}
      </span>
      <span
        class={`position-row-pnl-line text-mono ${pnlClass(props.closurePercent)}`}
        title={POSITION_TOOLTIPS.pnlOpenClosurePercent}
      >
        {formatPnlPercent(props.closurePercent)}
        <span class="position-row-pnl-tag">clôture</span>
      </span>
      <span
        class={`position-row-pnl-line text-mono ${pnlClass(props.triggerPercent)}`}
        title={POSITION_TOOLTIPS.pnlOpenTriggerPercent}
      >
        {formatPnlPercent(props.triggerPercent)}
        <span class="position-row-pnl-tag">marché</span>
      </span>
      <span
        class="position-row-pnl-line text-mono market-inline-metric"
        title={POSITION_TOOLTIPS.spread}
      >
        Δ {formatSpread(tick()?.spreadTop)}
        <span class="position-row-pnl-tag">spread</span>
      </span>
      <span
        class="position-row-pnl-line text-mono market-inline-metric"
        title={POSITION_TOOLTIPS.lastTrade}
      >
        {formatPrice(tick()?.lastTradePrice)}
        <span class="position-row-pnl-tag">last</span>
      </span>
      <Show when={slDistance().active}>
        <span
          class={`position-row-pnl-line text-mono ${slClass()}`}
          title={POSITION_TOOLTIPS.slDistance}
        >
          {slLabel()}
          <span class="position-row-pnl-tag">SL</span>
        </span>
      </Show>
    </div>
  );
}
