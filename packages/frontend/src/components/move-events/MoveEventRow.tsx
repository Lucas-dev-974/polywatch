import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { closeExecutionErrorLabel } from '../../lib/execution';
import {
  MOVE_EVENT_LABELS,
  copySlippageClass,
  formatCopySlippage,
  formatMoveEventTime,
  formatTraderBet,
  moveEventBadgeClass,
  moveEventMarketLabel,
  moveEventStatusBadge,
  type MoveEvent,
} from '../../lib/move-events';

function modeBadge(event: MoveEvent, mode: 'sim' | 'real'): JSX.Element | null {
  const isExecuted = mode === 'sim' ? event.executedSim : event.executedReal;
  const skipReason = mode === 'sim' ? event.skipReasonsSim : event.skipReasonsReal;
  const execErrorRaw = mode === 'sim' ? event.executionErrorSim : event.executionErrorReal;
  const execError = closeExecutionErrorLabel(execErrorRaw);
  const label = mode === 'sim' ? 'Sim' : 'Live';

  if (isExecuted) {
    return <span class={`badge ${mode}`}>{label}</span>;
  }

  const detail = skipReason ?? execError;
  if (detail) {
    return (
      <span class="badge danger" title={detail}>
        {label}
      </span>
    );
  }

  return null;
}

interface MoveEventRowProps {
  event: MoveEvent;
}

export function MoveEventRow(props: MoveEventRowProps) {
  const event = () => props.event;
  const status = () => moveEventStatusBadge(event());

  return (
    <tr>
      <td class="text-mono">{formatMoveEventTime(event().detectedAt)}</td>
      <td>
        <div class="event-trader-name">{event().traderName}</div>
        <div class="event-trader-address">{event().traderAddress}</div>
        <div class="event-market-combined">
          <Show
            when={event().marketUrl}
            fallback={
              <span class="text-mono" title={event().conditionId}>
                {moveEventMarketLabel(event())}
              </span>
            }
          >
            <a
              class="event-market-link"
              href={event().marketUrl!}
              target="_blank"
              rel="noopener noreferrer"
              title={event().conditionId}
            >
              {moveEventMarketLabel(event())}
            </a>
          </Show>
        </div>
      </td>
      <td>
        <span class={`badge ${moveEventBadgeClass(event().eventType)}`}>
          {MOVE_EVENT_LABELS[event().eventType] ?? event().eventType}
        </span>
      </td>
      <td class="text-mono">{formatTraderBet(event())}</td>
      <td>
        <span class={`badge ${copySlippageClass(event().copySlippage)}`}>
          {formatCopySlippage(event().copySlippage)}
        </span>
      </td>
      <td>
        <div class="event-mode-badges">
          {modeBadge(event(), 'sim')}
          {modeBadge(event(), 'real')}
          <Show
            when={
              !event().executedSim &&
              !event().executedReal &&
              !event().skipReasonsSim &&
              !event().skipReasonsReal &&
              !event().executionErrorSim &&
              !event().executionErrorReal
            }
          >
            <span class="badge neutral">—</span>
          </Show>
        </div>
      </td>
      <td>
        <span class={`badge ${status().className}`} title={status().title}>
          {status().label}
        </span>
      </td>
    </tr>
  );
}
