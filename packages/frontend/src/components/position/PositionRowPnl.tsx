import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import {
  COLLATERAL_TOKEN,
  formatPnlAmount,
  formatPnlPercent,
  pnlClass,
} from '../../lib/position';

interface Props {
  amount: number;
  percent: number | undefined;
  mode: string;
  signed?: boolean;
}

export function PositionRowPnl(props: Props) {
  return (
    <div class="position-row-pnl">
      <span
        class={`position-row-pnl-amount text-mono ${pnlClass(props.amount)}`}
        title={POSITION_TOOLTIPS.pnlClosedAmount}
      >
        {formatPnlAmount(props.amount, props.signed ?? true)}{' '}
        {COLLATERAL_TOKEN}
      </span>
      <span
        class={`position-row-pnl-percent text-mono ${pnlClass(props.percent)}`}
        title={POSITION_TOOLTIPS.pnlClosedPercent}
      >
        {formatPnlPercent(props.percent)}
      </span>
    </div>
  );
}
