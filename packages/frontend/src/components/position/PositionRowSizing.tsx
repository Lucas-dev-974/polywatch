import { Show } from 'solid-js';

import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import {
  COLLATERAL_TOKEN,
  entryFeesForPosition,
  entryQuantityForDisplay,
  formatCurrencyAmount,
  formatShareQuantity,
  investedAmount,
  type Position,
} from '../../lib/position';
import { PositionRowMetaSep } from './PositionRow';

interface Props {
  pos: Pick<
    Position,
    | 'mode'
    | 'quantity'
    | 'entryPrice'
    | 'entryFees'
    | 'entryFeesRemaining'
    | 'status'
    | 'entryQuantityFilled'
    | 'entryInvestedAmount'
  >;
}

export function PositionRowSizing(props: Props) {
  const invested = () => investedAmount(props.pos);
  const entryFees = () => entryFeesForPosition(props.pos);
  const quantity = () => entryQuantityForDisplay(props.pos);
  const currency = () => COLLATERAL_TOKEN;

  return (
    <>
      <span class="text-mono position-invested" title={POSITION_TOOLTIPS.invested}>
        {formatCurrencyAmount(invested())} {currency()}
      </span>
      <PositionRowMetaSep />
      <span class="text-mono position-sizing" title={POSITION_TOOLTIPS.sizing}>
        {formatShareQuantity(quantity())} @ {props.pos.entryPrice.toFixed(4)}
      </span>
      <Show when={entryFees() > 0}>
        <PositionRowMetaSep />
        <span class="text-mono" title={POSITION_TOOLTIPS.entryFees}>
          frais entrée {formatCurrencyAmount(entryFees())} {currency()}
        </span>
      </Show>
    </>
  );
}
