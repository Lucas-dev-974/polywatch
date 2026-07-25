import { Show } from 'solid-js';

import { primaryMarketTagLabel } from '../../lib/market-tags';
import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import { marketLabel, type Position } from '../../lib/position';
import { MarketIcon } from './MarketIcon';

type MarketFields = Pick<
  Position,
  | 'marketUrl'
  | 'marketQuestion'
  | 'marketCategory'
  | 'conditionId'
  | 'outcome'
  | 'marketTagSlugs'
>;

interface Props {
  pos: MarketFields;
  compact?: boolean;
  showOutcome?: boolean;
}

export function PositionMarketLink(props: Props) {
  const pos = () => props.pos;
  const showOutcome = () => props.showOutcome ?? !props.compact;
  const marketTag = () =>
    primaryMarketTagLabel(
      pos().marketTagSlugs,
      pos().marketCategory,
      pos().marketQuestion,
    );

  return (
    <div class="compact-market-row">
      <Show when={marketTag()}>
        <span
          class="badge badge-xs neutral position-market-tag"
          title={POSITION_TOOLTIPS.marketTag}
        >
          {marketTag()}
        </span>
      </Show>
      <Show when={props.compact}>
        <MarketIcon
          conditionId={pos().conditionId}
          label={marketLabel(pos())}
          size={22}
        />
      </Show>
      <a
        class={`position-market-link${props.compact ? ' compact-market-link' : ''}`}
        href={pos().marketUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        title={
          pos().marketQuestion
            ? `${POSITION_TOOLTIPS.marketLink} — ${pos().marketQuestion}`
            : POSITION_TOOLTIPS.marketLink
        }
      >
        {marketLabel(pos())}
      </a>
      {showOutcome() && (
        <span class="position-outcome" title={POSITION_TOOLTIPS.outcome}>
          {pos().outcome}
        </span>
      )}
    </div>
  );
}
