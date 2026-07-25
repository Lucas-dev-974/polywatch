import { Show, type JSX } from 'solid-js';

import { formatShortDateTime } from '../../lib/date';
import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import {
  marketLifecycleBadgeClass,
  marketLifecycleLabel,
  redemptionProgressBadge,
  shouldShowMarketEndCountdown,
  subMarketOutcomeKnownBadge,
  type Position,
} from '../../lib/position';
import { PositionCountdown } from './PositionCountdown';
import { PositionRowSizing } from './PositionRowSizing';

interface Props {
  pos: Position;
  now: () => number;
}

/** Shared meta line for open-like position rows (sizing, dates, lifecycle badge). */
export function PositionOpenRowMeta(props: Props): JSX.Element {
  const pos = () => props.pos;
  const outcomeBadge = () => subMarketOutcomeKnownBadge(pos());
  const redemptionBadge = () => redemptionProgressBadge(pos(), props.now());

  return (
    <>
      {/* Ligne 1 : dates */}
      <div class="position-row-meta-line">
        <Show when={pos().openedAt}>
          <span title={POSITION_TOOLTIPS.openedAt}>
            {formatShortDateTime(pos().openedAt)}
          </span>
        </Show>
        <Show when={shouldShowMarketEndCountdown(pos())}>
          <span class="position-row-meta-sep">·</span>
          <span
            title={`${POSITION_TOOLTIPS.marketEndCountdown} — ${formatShortDateTime(pos().marketEndDate)}`}
          >
            <PositionCountdown endDate={pos().marketEndDate} />
          </span>
        </Show>
        <Show when={outcomeBadge()}>
          <span class="position-row-meta-sep">·</span>
          <span
            class={`badge badge-xs ${outcomeBadge()!.badgeClass}`}
            title={outcomeBadge()!.tooltip}
          >
            {outcomeBadge()!.label}
          </span>
        </Show>
        <Show when={redemptionBadge()}>
          <span class="position-row-meta-sep">·</span>
          <span
            class={`badge badge-xs ${redemptionBadge()!.badgeClass}`}
            title={redemptionBadge()!.tooltip}
          >
            {redemptionBadge()!.label}
          </span>
        </Show>
        <Show when={marketLifecycleLabel(pos())}>
          <span class="position-row-meta-sep">·</span>
          <span
            class={`badge badge-xs ${marketLifecycleBadgeClass(pos())}`}
            title={
              pos().marketResolved
                ? POSITION_TOOLTIPS.marketResolved
                : POSITION_TOOLTIPS.marketClosed
            }
          >
            {marketLifecycleLabel(pos())}
          </span>
        </Show>
      </div>
      {/* Ligne 2 : prix */}
      <div class="position-row-meta-line">
        <PositionRowSizing pos={pos()} />
      </div>
    </>
  );
}
