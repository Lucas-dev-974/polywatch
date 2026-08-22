import { createSignal, For, Show } from 'solid-js';
import { formatWeatherDate } from '../../lib/weather-position';
import { Icon } from '../Icon';
import { WeatherPositionRow } from './WeatherPositionRow';
import type {
  ClosePositionHandler,
  OpenChartHandler,
  WeatherPositionDateGroup,
} from './types';

interface WeatherPositionDateDropdownProps {
  group: WeatherPositionDateGroup;
  defaultOpen: boolean;
  onOpenChart: OpenChartHandler;
  onClose?: ClosePositionHandler;
}

export function WeatherPositionDateDropdown(props: WeatherPositionDateDropdownProps) {
  const [open, setOpen] = createSignal(props.defaultOpen);
  return (
    <div class="weather-history-date-dropdown">
      <button
        type="button"
        class="weather-history-date-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open()}
      >
        <span class="weather-history-date-btn__label">
          {formatWeatherDate(props.group.targetDate)}
        </span>
        <span class="weather-history-date-btn__count">
          {props.group.positions.length} position
          {props.group.positions.length > 1 ? 's' : ''}
        </span>
        <Icon name={open() ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      <Show when={open()}>
        <div class="weather-history-pos-list">
          <For each={props.group.positions}>
            {(pos) => (
              <WeatherPositionRow
                pos={pos}
                onOpenChart={props.onOpenChart}
                onClose={props.onClose}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
