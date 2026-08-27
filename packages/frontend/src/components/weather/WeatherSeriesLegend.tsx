import { For, Show } from 'solid-js';
import { Icon } from '../Icon';
import { formatCents } from '../../lib/format';

export interface WeatherSeriesLegendItem {
  key: number;
  label: string;
  price: number | null;
  color: string;
  hidden: boolean;
}

/**
 * Légende de séries pour les timelines bucket (bucket ticks et clob price history).
 * Affiche une puce, un libellé, un séparateur, le dernier prix et un toggle
 * masquer/afficher par série.
 */
export function WeatherSeriesLegend(props: {
  visibleCount: number;
  totalCount: number;
  items: WeatherSeriesLegendItem[];
  onToggle: (index: number) => void;
}) {
  return (
    <div class="weather-bucket-legend">
      <div class="weather-bucket-legend-header">
        <span class="weather-bucket-legend-title">Buckets</span>
        <span class="weather-bucket-legend-count">
          {props.visibleCount} / {props.totalCount} affichés
        </span>
      </div>
      <div class="weather-bucket-legend-list">
        <For each={props.items}>
          {(item) => (
            <div
              role="button"
              tabindex="0"
              class={`weather-bucket-legend-item${item.hidden ? ' weather-bucket-legend-item--hidden' : ''}`}
              style={{ 'border-color': item.color }}
              onClick={() => props.onToggle(item.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onToggle(item.key);
                }
              }}
              title={item.hidden ? 'Afficher la série' : 'Masquer la série'}
            >
              <span class="weather-bucket-legend-swatch" style={{ background: item.color }} />
              <span class="weather-bucket-legend-label">{item.label}</span>
              <span class="weather-bucket-legend-sep" />
              <span class="weather-bucket-legend-price">
                {item.price != null ? formatCents(item.price) : '—'}
              </span>
              <Show when={!item.hidden}>
                <span class="weather-bucket-legend-eye" aria-hidden="true">
                  <Icon name="eye" size={13} />
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
