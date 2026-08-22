import { Show, type JSX } from 'solid-js';

interface WeatherPositionMetricProps {
  label: string;
  value: JSX.Element;
  className?: string;
}

/** Métrique réutilisable d'une ligne de position weather (label + valeur). */
export function WeatherPositionMetric(props: WeatherPositionMetricProps) {
  return (
    <Show when={props.value !== undefined}>
      <span class="weather-history-pos-item__metric">
        <span class="weather-history-pos-item__label">{props.label}</span>
        <span class={props.className ?? ''}>{props.value}</span>
      </span>
    </Show>
  );
}
