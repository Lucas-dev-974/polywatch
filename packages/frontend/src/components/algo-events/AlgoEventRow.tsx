import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { closeExecutionErrorLabel } from '../../lib/execution';
import { formatCopySlippage, copySlippageClass } from '../../lib/move-events';
import {
  formatAlgoEventTime,
  algoEventBadgeClass,
  algoEventMarketLabel,
  algoEventStatusLabel,
  type AlgoEvent,
} from '../../lib/algo-events';

function modeBadge(event: AlgoEvent, mode: 'sim' | 'real'): JSX.Element | null {
  const isExecuted = mode === 'sim' ? event.executedSim : event.executedReal;
  const execErrorRaw = mode === 'sim' ? event.executionErrorSim : event.executionErrorReal;
  const execError = closeExecutionErrorLabel(execErrorRaw);
  const label = mode === 'sim' ? 'Sim' : 'Live';

  if (isExecuted) {
    return <span class={`badge ${mode}`}>{label}</span>;
  }

  if (execError) {
    return (
      <span class="badge danger" title={execError}>
        {label}
      </span>
    );
  }

  return null;
}

interface AlgoEventRowProps {
  event: AlgoEvent;
}

export function AlgoEventRow(props: AlgoEventRowProps) {
  const event = () => props.event;
  const status = () => event().status;

  return (
    <tr>
      <td class="text-mono">{formatAlgoEventTime(event().marketStartAt)}</td>
      <td>
        <div class="event-trader-name">
          {event().cryptoSymbol ?? '—'} · {event().interval ?? '—'}
        </div>
        <div class="event-market-combined">
          <span
            class="text-mono"
            title={event().conditionId}
          >
            {algoEventMarketLabel(event())}
          </span>
        </div>
      </td>
      <td>
        <span class="badge neutral">Surveillance</span>
      </td>
      <td class="text-mono">—</td>
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
              !event().executionErrorSim &&
              !event().executionErrorReal
            }
          >
            <span class="badge neutral">—</span>
          </Show>
        </div>
      </td>
      <td>
        <span class={`badge ${algoEventBadgeClass(status())}`}>
          {algoEventStatusLabel(status())}
        </span>
      </td>
    </tr>
  );
}
