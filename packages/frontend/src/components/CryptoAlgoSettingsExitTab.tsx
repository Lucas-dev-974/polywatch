import { createMemo, For, Show } from 'solid-js';
import {
  CODE_DEFAULT_EXIT_BY_INTERVAL,
  CODE_DEFAULT_PRE_CLOSE_SECONDS,
  type CryptoAlgoSettings,
} from './settings/crypto-algo-settings-types';
import { JsonIntervalMapField } from './JsonIntervalMapField';
import { NumberField, NullableNumberField, ToggleField } from './settings/settings-fields';

/** Mirrors core `CRYPTO_INTERVAL_EXIT_DEFAULTS` for 5m hint text. */
const EXIT_DEFAULTS_5M = CODE_DEFAULT_EXIT_BY_INTERVAL['5m'];

/** Default pre-close delays by interval (seconds) — mirrors core `crypto-algo-exit.ts`. */
const INTERVAL_PRE_CLOSE_SECONDS = CODE_DEFAULT_PRE_CLOSE_SECONDS;

export interface CryptoAlgoSettingsExitTabProps {
  config: CryptoAlgoSettings;
  onChange: (patch: Partial<CryptoAlgoSettings>) => void;
  onJsonValidityChange?: (fieldId: string, valid: boolean) => void;
}

export function CryptoAlgoSettingsExitTab(props: CryptoAlgoSettingsExitTabProps) {
  const absoluteHint = `Seuils en % de la mise investie (cost basis + frais). 0..100. Defaults 5m : SL ${EXIT_DEFAULTS_5M.slPercent}, TP ${EXIT_DEFAULTS_5M.tpPercent}.`;
  const trailingHint = `Champ vide = defaults par intervalle (ex. 5m : ${EXIT_DEFAULTS_5M.trailingPercent} % de la mise). 0 = désactivé.`;

  const effectivePreCloseSeconds = () => props.config.cryptoAlgoPreCloseSeconds ?? null;

  const warnings = createMemo(() => {
    const msgs: string[] = [];
    const seconds = effectivePreCloseSeconds();
    if (seconds != null && seconds < 30) {
      msgs.push(
        'Un délai de pré-clôture inférieur à 30 s laisse peu de marge pour exécuter la vente.',
      );
    }
    return msgs;
  });

  return (
    <section class="settings-section settings-section-full">
      <p class="form-hint settings-intro">
        Stop loss, take profit et trailing stop appliqués pendant la phase liquide
        du marché (avant la fenêtre de sortie forcée). Chaque jambe est
        indépendante.
      </p>
      <ToggleField
        label="Stop Loss"
        checked={props.config.cryptoAlgoSlEnabled}
        onChange={(checked) => props.onChange({ cryptoAlgoSlEnabled: checked })}
      />
      <Show when={props.config.cryptoAlgoSlEnabled}>
        <NullableNumberField
          label="Stop Loss (% de la mise) — override global"
          value={props.config.cryptoAlgoSlPercent}
          min={0}
          max={100}
          step={1}
          placeholder={`auto (${EXIT_DEFAULTS_5M.slPercent})`}
          hint={absoluteHint}
          onChange={(value) => props.onChange({ cryptoAlgoSlPercent: value })}
        />
      </Show>
      <ToggleField
        label="Take Profit"
        checked={props.config.cryptoAlgoTpEnabled}
        onChange={(checked) => props.onChange({ cryptoAlgoTpEnabled: checked })}
      />
      <Show when={props.config.cryptoAlgoTpEnabled}>
        <NullableNumberField
          label="Take Profit (% de la mise) — override global"
          value={props.config.cryptoAlgoTpPercent}
          min={0}
          max={100}
          step={1}
          placeholder={`auto (${EXIT_DEFAULTS_5M.tpPercent})`}
          hint={absoluteHint}
          onChange={(value) => props.onChange({ cryptoAlgoTpPercent: value })}
        />
      </Show>
      <ToggleField
        label="Trailing stop"
        checked={props.config.cryptoAlgoTrailingEnabled}
        onChange={(checked) =>
          props.onChange({ cryptoAlgoTrailingEnabled: checked })
        }
      />
      <Show when={props.config.cryptoAlgoTrailingEnabled}>
        <NullableNumberField
          label="Trailing stop (% de la mise) — override global"
          value={props.config.cryptoAlgoTrailingPercent}
          min={0}
          max={100}
          step={1}
          placeholder={`auto (${EXIT_DEFAULTS_5M.trailingPercent})`}
          hint={trailingHint}
          onChange={(value) =>
            props.onChange({ cryptoAlgoTrailingPercent: value })
          }
        />
        <NullableNumberField
          label="Activation trailing (% de la mise) — override global"
          value={props.config.cryptoAlgoTrailingActivationPercent}
          min={0}
          max={100}
          step={1}
          placeholder={`auto (${EXIT_DEFAULTS_5M.trailingActivationPercent})`}
          hint={`${trailingHint} 0 = actif dès l'ouverture si désactivé explicitement.`}
          onChange={(value) =>
            props.onChange({ cryptoAlgoTrailingActivationPercent: value })
          }
        />
      </Show>
      <JsonIntervalMapField
        label="Defaults SL/TP/trailing par intervalle (JSON)"
        hint="Merge partiel par clé d'intervalle. Les champs globaux ci-dessus priment sur ces defaults. Les switches désactivent la jambe même si un default existe."
        placeholder={JSON.stringify(CODE_DEFAULT_EXIT_BY_INTERVAL, null, 2)}
        value={
          props.config.cryptoAlgoExitDefaultsByInterval as Record<string, unknown> | null
        }
        valueKind="exit"
        onValidityChange={(valid) =>
          props.onJsonValidityChange?.('cryptoAlgoExitDefaultsByInterval', valid)
        }
        onChange={(value) =>
          props.onChange({
            cryptoAlgoExitDefaultsByInterval: value as CryptoAlgoSettings['cryptoAlgoExitDefaultsByInterval'],
          })
        }
      />

      <hr class="settings-separator" />

      <p class="form-hint settings-intro">
        Pré-clôture : vente forcée avant la résolution du marché. Exemple 5m :
        fenêtre à T-120s — les positions ouvertes sont vendues sauf si Keep est
        activé et le bid dépasse le seuil.
      </p>

      <div class="form-field">
        <label>Pré-clôture</label>
        <p class="form-hint">
          Indépendant du copy trading. Désactivée = pas de vente forcée avant
          `endDate` (SL/TP/trailing restent actifs). La fenêtre d&apos;entrée
          (min time-to-close) reste basée sur le délai ci-dessous / table par
          intervalle.
        </p>
        <select
          class="input input-sm"
          value={props.config.cryptoAlgoPreCloseEnabled === true ? 'enabled' : 'disabled'}
          onChange={(e) => {
            const enabled = e.currentTarget.value === 'enabled';
            if (!enabled) {
              props.onChange({
                cryptoAlgoPreCloseEnabled: false,
                cryptoAlgoPreCloseSeconds: null,
                cryptoAlgoPreCloseKeepEnabled: null,
                cryptoAlgoPreCloseKeepBidThreshold: null,
              });
              return;
            }
            props.onChange({ cryptoAlgoPreCloseEnabled: true });
          }}
        >
          <option value="enabled">Activée</option>
          <option value="disabled">Désactivée</option>
        </select>
      </div>

      <Show when={props.config.cryptoAlgoPreCloseEnabled === true}>
        <NullableNumberField
          label="Délai pré-clôture (secondes)"
          value={props.config.cryptoAlgoPreCloseSeconds}
          min={0}
          step={1}
          placeholder={`auto (${INTERVAL_PRE_CLOSE_SECONDS['5m']})`}
          hint={`Vide = table par intervalle (ex. ${INTERVAL_PRE_CLOSE_SECONDS['5m']} s pour 5m). 0 = table aussi.`}
          onChange={(value) =>
            props.onChange({
              cryptoAlgoPreCloseSeconds:
                value != null && value > 0 ? value : null,
            })
          }
        />
        <div class="form-field">
          <label>Conserver si position gagnante</label>
          <select
            class="input input-sm"
            value={
              props.config.cryptoAlgoPreCloseKeepEnabled === true ? 'keep' : 'close'
            }
            onChange={(e) => {
              props.onChange({
                cryptoAlgoPreCloseKeepEnabled: e.currentTarget.value === 'keep',
              });
            }}
          >
            <option value="close">Toujours clôturer (recommandé)</option>
            <option value="keep">Conserver si gagnante</option>
          </select>
          <p class="form-hint">
            Recommandé : toujours clôturer sur binaires 5m/15m (ne pas bloquer la
            pré-clôture sur un fill légèrement positif).
          </p>
        </div>
        <Show when={props.config.cryptoAlgoPreCloseKeepEnabled === true}>
          <NullableNumberField
            label="Seuil Keep (bid)"
            value={props.config.cryptoAlgoPreCloseKeepBidThreshold}
            min={0}
            max={1}
            step={0.01}
            placeholder="0.80"
            hint="Conserve les positions dont le bid est ≥ ce seuil jusqu'à la résolution."
            onChange={(value) =>
              props.onChange({
                cryptoAlgoPreCloseKeepBidThreshold:
                  value != null && value >= 0 && value <= 1 ? value : null,
              })
            }
          />
        </Show>
      </Show>

      <NumberField
        label="Entrée min. avant fin (secondes)"
        value={props.config.cryptoAlgoMinTimeToClose ?? 0}
        min={0}
        step={1}
        hint="0 = pré-clôture (délai/table) + buffer (ex. 150 s pour 5m), même si la vente pré-clôture est désactivée. Refuse les entrées trop tardives."
        onChange={(value) =>
          props.onChange({
            cryptoAlgoMinTimeToClose: value > 0 ? value : null,
          })
        }
      />
      <NullableNumberField
        label="Buffer min time-to-close (secondes)"
        value={props.config.cryptoAlgoMinTimeToCloseBufferSeconds}
        min={0}
        max={600}
        step={1}
        placeholder="30"
        hint="Ajouté à la pré-clôture quand l'entrée min est auto."
        onChange={(value) =>
          props.onChange({ cryptoAlgoMinTimeToCloseBufferSeconds: value })
        }
      />
      <NullableNumberField
        label="Âge max last closeable bid (ms)"
        value={props.config.cryptoAlgoLastCloseableBidMaxAgeMs}
        min={1000}
        max={600_000}
        step={1000}
        placeholder="60000"
        onChange={(value) =>
          props.onChange({ cryptoAlgoLastCloseableBidMaxAgeMs: value })
        }
      />

      <JsonIntervalMapField
        label="Pré-clôture par intervalle — JSON"
        hint="Secondes avant fin (entiers). Merge partiel ; le délai global ci-dessus prime."
        placeholder={JSON.stringify(CODE_DEFAULT_PRE_CLOSE_SECONDS, null, 2)}
        value={
          props.config.cryptoAlgoPreCloseSecondsByInterval as Record<string, unknown> | null
        }
        valueKind="seconds"
        onValidityChange={(valid) =>
          props.onJsonValidityChange?.('cryptoAlgoPreCloseSecondsByInterval', valid)
        }
        onChange={(value) =>
          props.onChange({
            cryptoAlgoPreCloseSecondsByInterval: value as Record<string, number> | null,
          })
        }
      />

      <div class="form-field">
        <label>Délais pré-clôture effectifs par intervalle</label>
        <p class="form-hint" style="font-family: var(--mono); font-size: 0.8rem;">
          5m : {INTERVAL_PRE_CLOSE_SECONDS['5m']}s
          {' · '}
          15m : {INTERVAL_PRE_CLOSE_SECONDS['15m']}s
          {' · '}
          1h : {INTERVAL_PRE_CLOSE_SECONDS['1h']}s
        </p>
      </div>

      <Show when={warnings().length > 0}>
        <For each={warnings()}>
          {(msg) => <p class="form-hint" style="color: var(--warning);">{msg}</p>}
        </For>
      </Show>
    </section>
  );
}
