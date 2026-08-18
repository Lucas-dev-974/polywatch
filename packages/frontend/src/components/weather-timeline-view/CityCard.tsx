import { Show, type JSX } from 'solid-js';
import type { WeatherTimelineCityData } from '../weather-timeline-types';
import { formatChartTime } from './format';

export function CityCard<T>(props: {
  city: WeatherTimelineCityData<T>;
  unitLabel: string;
  renderExtra?: () => JSX.Element;
  onClick: () => void;
}) {
  const c = props.city;
  return (
    <button type="button" class="weather-data-card" onClick={props.onClick}>
      <div class="weather-data-card-header">
        <div class="weather-data-card-heading">
          <span class="weather-data-card-title">{c.key}</span>
          <code class="weather-data-card-table">
            {c.bucketCount} bucket{c.bucketCount > 1 ? 's' : ''}
          </code>
        </div>
        <span class="weather-data-card-count">{c.bucketCount}</span>
      </div>
      <Show when={props.renderExtra}>{props.renderExtra!()}</Show>
      <dl class="weather-data-card-stats">
        <div>
          <dt>Premier {props.unitLabel}</dt>
          <dd>{formatChartTime(new Date(c.firstRecordedAt).getTime(), 0)}</dd>
        </div>
        <div>
          <dt>Dernier {props.unitLabel}</dt>
          <dd>{formatChartTime(new Date(c.lastRecordedAt).getTime(), 0)}</dd>
        </div>
        <div class="weather-data-card-cta" aria-hidden="true">
          <span>Voir</span>
          <span class="weather-data-card-cta-arrow">→</span>
        </div>
      </dl>
    </button>
  );
}
