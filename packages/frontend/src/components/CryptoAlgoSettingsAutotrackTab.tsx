import { createSignal, For, Show } from 'solid-js';
import { CRYPTO_SYMBOLS } from '@polywatch/core/market-list';
import { INTERVAL_FILTER_OPTIONS } from '../lib/markets-list';
import {
  createAutoTrackRule,
  deleteAutoTrackRule,
  rules,
  setAutoTrackRuleEnabled,
} from '../stores/autoTrackStore';
import { Icon } from './Icon';

export interface CryptoAlgoSettingsAutotrackTabProps {
  onAutoTrackChange?: () => void;
}

export function CryptoAlgoSettingsAutotrackTab(
  props: CryptoAlgoSettingsAutotrackTabProps,
) {
  const [newSymbol, setNewSymbol] = createSignal('');
  const [newInterval, setNewInterval] = createSignal('');
  const [autoTrackError, setAutoTrackError] = createSignal<string | null>(null);

  function notifyAutoTrackChange() {
    props.onAutoTrackChange?.();
  }

  return (
    <section class="settings-section settings-section-full">
      <h3 class="settings-section-title">Suivi automatique</h3>
      <p class="form-hint">
        Définissez des règles symbole + intervalle pour découvrir et enchaîner
        automatiquement les marchés Up/Down actifs.
      </p>
      <div class="autotrack-add-form-v2">
        <select
          class="input input-sm"
          value={newSymbol()}
          onChange={(e) => setNewSymbol(e.currentTarget.value)}
        >
          <option value="">Symbole…</option>
          <For each={CRYPTO_SYMBOLS}>
            {(s) => <option value={s}>{s}</option>}
          </For>
        </select>
        <select
          class="input input-sm"
          value={newInterval()}
          onChange={(e) => setNewInterval(e.currentTarget.value)}
        >
          <option value="">Intervalle…</option>
          <For each={INTERVAL_FILTER_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
        <button
          class="btn btn-secondary btn-sm"
          disabled={!newSymbol() || !newInterval()}
          onClick={async () => {
            setAutoTrackError(null);
            try {
              await createAutoTrackRule(newSymbol(), newInterval());
              setNewSymbol('');
              setNewInterval('');
              notifyAutoTrackChange();
            } catch (e) {
              setAutoTrackError((e as Error).message);
            }
          }}
        >
          Ajouter
        </button>
      </div>
      <Show when={autoTrackError()}>
        <p class="form-error">{autoTrackError()}</p>
      </Show>
      <Show
        when={rules().length > 0}
        fallback={<p class="form-hint">Aucune règle de suivi automatique.</p>}
      >
        <div class="algo-table-wrap">
          <table class="algo-table">
            <thead>
              <tr>
                <th>Symbole</th>
                <th>Intervalle</th>
                <th class="col-center">Actif</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <For each={rules()}>
                {(rule) => (
                  <tr>
                    <td>
                      <span class="algo-badge">{rule.cryptoSymbol}</span>
                    </td>
                    <td>
                      <span class="algo-badge muted">{rule.interval}</span>
                    </td>
                    <td class="col-center">
                      <label class="toggle-switch toggle-switch-sm">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => {
                            void (async () => {
                              await setAutoTrackRuleEnabled(
                                rule.id,
                                e.currentTarget.checked,
                              );
                              notifyAutoTrackChange();
                            })();
                          }}
                        />
                        <span class="toggle-track" />
                      </label>
                    </td>
                    <td class="col-actions">
                      <button
                        class="btn btn-ghost btn-sm btn-danger"
                        onClick={async () => {
                          await deleteAutoTrackRule(rule.id);
                          notifyAutoTrackChange();
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
