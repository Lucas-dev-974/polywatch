import { createMemo, For, Show } from 'solid-js';
import {
  CODE_DEFAULT_EXIT_BY_INTERVAL,
  CODE_DEFAULT_PRE_CLOSE_SECONDS,
  type CryptoAlgoSettings,
} from './crypto-algo-settings-types';
import { JsonIntervalMapField } from './JsonIntervalMapField';
import { NumberField, NullableNumberField, ToggleField } from './settings-fields';

/** Mirrors core `CRYPTO_INTERVAL_EXIT_DEFAULTS` for 5m hint text. */
const EXIT_DEFAULTS_5M = CODE_DEFAULT_EXIT_BY_INTERVAL['5m'];

/** Default delays by interval (seconds) — mirrors core `crypto-algo-exit.ts`. */
const INTERVAL_SOFT_SECONDS = CODE_DEFAULT_PRE_CLOSE_SECONDS;

export interface CryptoAlgoSettingsExitTabProps {
  config: CryptoAlgoSettings;
  onChange: (patch: Partial<CryptoAlgoSettings>) => void;
  onJsonValidityChange?: (fieldId: string, valid: boolean) => void;
}

export function CryptoAlgoSettingsExitTab(props: CryptoAlgoSettingsExitTabProps) {
  const absoluteHint = `Points de bid sous/au-dessus du bid d'entrée. 0..1. Marchés binaires seulement. Defaults 5m : SL ${EXIT_DEFAULTS_5M.slBidPoints}, TP ${EXIT_DEFAULTS_5M.tpBidPoints}.`;
  const trailingHint = `Champ vide = defaults par intervalle (ex. 5m : ${EXIT_DEFAULTS_5M.trailingBidPoints} points bid). 0 = désactivé.`;

  const effectiveSoft = () => props.config.cryptoAlgoPreCloseSeconds ?? null;

  const warnings = createMemo(() => {
    const msgs: string[] = [];
    const soft = effectiveSoft();
    if (soft != null && soft < 30) {
      msgs.push('Un délai SOFT inférieur à 30 s laisse peu de marge pour exécuter la vente.');
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
          label="Stop Loss (points bid) — override global"
          value={props.config.cryptoAlgoSlBidPoints}
          min={0}
          max={1}
          step={0.01}
          placeholder={`auto (${EXIT_DEFAULTS_5M.slBidPoints})`}
          hint={absoluteHint}
          onChange={(value) => props.onChange({ cryptoAlgoSlBidPoints: value })}
        />
      </Show>
      <ToggleField
        label="Take Profit"
        checked={props.config.cryptoAlgoTpEnabled}
        onChange={(checked) => props.onChange({ cryptoAlgoTpEnabled: checked })}
      />
      <Show when={props.config.cryptoAlgoTpEnabled}>
        <NullableNumberField
          label="Take Profit (points bid) — override global"
          value={props.config.cryptoAlgoTpBidPoints}
          min={0}
          max={1}
          step={0.01}
          placeholder={`auto (${EXIT_DEFAULTS_5M.tpBidPoints})`}
          hint={absoluteHint}
          onChange={(value) => props.onChange({ cryptoAlgoTpBidPoints: value })}
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
          label="Trailing stop (points bid) — override global"
          value={props.config.cryptoAlgoTrailingBidPoints}
          min={0}
          max={1}
          step={0.01}
          placeholder={`auto (${EXIT_DEFAULTS_5M.trailingBidPoints})`}
          hint={trailingHint}
          onChange={(value) =>
            props.onChange({ cryptoAlgoTrailingBidPoints: value })
          }
        />
        <NullableNumberField
          label="Activation trailing (points bid) — override global"
          value={props.config.cryptoAlgoTrailingActivationBidPoints}
          min={0}
          max={1}
          step={0.01}
          placeholder={`auto (${EXIT_DEFAULTS_5M.trailingActivationBidPoints})`}
          hint={`${trailingHint} 0 = actif dès l'ouverture si désactivé explicitement.`}
          onChange={(value) =>
            props.onChange({ cryptoAlgoTrailingActivationBidPoints: value })
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
        Sortie avant la résolution du marché en phase SOFT (pré-clôture des
        perdantes). Exemple 5m : SOFT à T-120s — une position incertaine (bid &lt;
        0,95) est vendue à 2 min de la fin.
      </p>

      <div class="form-field">
        <label>Pré-clôture (phase SOFT)</label>
        <p class="form-hint">
          « Hériter » reprend les réglages Simulation / Réel du copy trading.
        </p>
        <select
          class="input input-sm"
          value={
            props.config.cryptoAlgoPreCloseEnabled === null
              ? 'inherit'
              : props.config.cryptoAlgoPreCloseEnabled
                ? 'enabled'
                : 'disabled'
          }
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value === 'inherit') {
              props.onChange({
                cryptoAlgoPreCloseEnabled: null,
                cryptoAlgoPreCloseSeconds: null,
                cryptoAlgoPreCloseKeepEnabled: null,
                cryptoAlgoPreCloseKeepBidThreshold: null,
              });
              return;
            }
            props.onChange({
              cryptoAlgoPreCloseEnabled: value === 'enabled',
            });
          }}
        >
          <option value="inherit">Hériter (sim / réel)</option>
          <option value="enabled">Activée</option>
          <option value="disabled">Désactivée</option>
        </select>
      </div>

      <Show when={props.config.cryptoAlgoPreCloseEnabled === true}>
        <NumberField
          label="Délai phase SOFT (secondes)"
          value={props.config.cryptoAlgoPreCloseSeconds ?? 0}
          min={0}
          step={1}
          hint="0 ou vide = table par intervalle (ex. 120 s pour 5m)."
          onChange={(value) =>
            props.onChange({
              cryptoAlgoPreCloseSeconds: value > 0 ? value : null,
            })
          }
        />
        <div class="form-field">
          <label>Conserver si position gagnante (SOFT)</label>
          <select
            class="input input-sm"
            value={
              props.config.cryptoAlgoPreCloseKeepEnabled === null
                ? 'inherit'
                : props.config.cryptoAlgoPreCloseKeepEnabled
                  ? 'keep'
                  : 'close'
            }
            onChange={(e) => {
              const value = e.currentTarget.value;
              props.onChange({
                cryptoAlgoPreCloseKeepEnabled:
                  value === 'inherit' ? null : value === 'keep',
              });
            }}
          >
            <option value="inherit">Défaut algo (ne pas retenir)</option>
            <option value="keep">Conserver si gagnante</option>
            <option value="close">Toujours clôturer</option>
          </select>
          <p class="form-hint">
            Recommandé : « Défaut algo » pour les marchés binaires 5m/15m (ne pas
            bloquer le pre-close sur un fill légèrement positif).
          </p>
        </div>
        <NullableNumberField
          label="Seuil Keep (SOFT)"
          value={props.config.cryptoAlgoPreCloseKeepBidThreshold}
          min={0}
          max={1}
          step={0.01}
          placeholder="désactivé"
          hint="Vide = désactivé. Si renseigné, conserve les gagnantes dont le bid est au-dessus de ce seuil."
          onChange={(value) =>
            props.onChange({
              cryptoAlgoPreCloseKeepBidThreshold:
                value != null && value >= 0 && value <= 1 ? value : null,
            })
          }
        />
      </Show>

      <NumberField
        label="Entrée min. avant fin (secondes)"
        value={props.config.cryptoAlgoMinTimeToClose ?? 0}
        min={0}
        step={1}
        hint="Vide = SOFT + buffer (ex. 150 s pour 5m). Refuse les entrées trop tardives."
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
        hint="Ajouté à SOFT quand entrée min est auto."
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
        label="Pré-clôture (SOFT) par intervalle — JSON"
        hint="Secondes avant fin (entiers). Merge partiel ; le champ SOFT global ci-dessus prime."
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
        <label>Délais effectifs par intervalle</label>
        <p class="form-hint" style="font-family: var(--mono); font-size: 0.8rem;">
          5m : SOFT {INTERVAL_SOFT_SECONDS['5m']}s
          {' · '}
          15m : SOFT {INTERVAL_SOFT_SECONDS['15m']}s
          {' · '}
          1h : SOFT {INTERVAL_SOFT_SECONDS['1h']}s
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
