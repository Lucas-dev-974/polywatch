import { For, Show, type JSX } from 'solid-js';
import type { AutoTrackRule } from '../../hooks/useWeatherAlgoDashboard';
import { formatMetric } from '../../lib/weather-metric';

export interface WeatherWatchedTableProps {
  rules: AutoTrackRule[];
  onToggle: (id: number, enabled: boolean) => void;
  onRemove: (id: number) => void;
  /** Rendu de la cellule « Horizon » (statique ou éditable selon le contexte). */
  renderHorizon: (rule: AutoTrackRule) => JSX.Element;
  /** Contenu du bloc vide (légèrement différent entre les deux contextes). */
  emptyText: JSX.Element;
}

/**
 * Tableau des villes surveillées, partagé entre le panneau des marchés actifs
 * et l'onglet auto-track (R7). Seule la cellule « Horizon » diffère via le slot
 * `renderHorizon`.
 */
export function WeatherWatchedTable(props: WeatherWatchedTableProps) {
  return (
    <Show
      when={props.rules.length > 0}
      fallback={
        <div class="weather-watched-empty">
          <div class="weather-watched-empty-icon" aria-hidden="true">
            🌍
          </div>
          <p class="weather-watched-empty-title">Aucune ville surveillée</p>
          <p class="weather-watched-empty-text">{props.emptyText}</p>
        </div>
      }
    >
      <div class="weather-watched-table-wrap" role="region" aria-label="Villes surveillées">
        <table class="weather-watched-table">
          <thead>
            <tr>
              <th class="weather-watched-th">Ville</th>
              <th class="weather-watched-th">Métrique</th>
              <th class="weather-watched-th">Horizon</th>
              <th class="weather-watched-th">État</th>
              <th class="weather-watched-th weather-watched-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rules}>
              {(rule) => (
                <tr
                  class="weather-watched-tr"
                  classList={{ 'weather-watched-tr--disabled': !rule.enabled }}
                >
                  <td class="weather-watched-td weather-watched-td-city" data-label="Ville">
                    {rule.city}
                  </td>
                  <td class="weather-watched-td" data-label="Métrique">
                    {formatMetric(rule.metric)}
                  </td>
                  <td class="weather-watched-td" data-label="Horizon">
                    {props.renderHorizon(rule)}
                  </td>
                  <td class="weather-watched-td" data-label="État">
                    <span
                      class="weather-watched-badge"
                      classList={{
                        'weather-watched-badge--active': rule.enabled,
                        'weather-watched-badge--inactive': !rule.enabled,
                      }}
                    >
                      <span class="weather-watched-badge-dot" />
                      {rule.enabled ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td
                    class="weather-watched-td weather-watched-td-actions"
                    data-label="Actions"
                  >
                    <button
                      class="btn btn-sm btn-ghost"
                      onClick={() => props.onToggle(rule.id, !rule.enabled)}
                    >
                      {rule.enabled ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      class="btn btn-sm btn-ghost weather-watched-remove"
                      onClick={() => props.onRemove(rule.id)}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
