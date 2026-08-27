import { Show } from 'solid-js';
import {
  CODE_DEFAULT_SPREAD_ABS_BY_INTERVAL,
  type CryptoAlgoSettings,
} from './settings/crypto-algo-settings-types';
import { JsonIntervalMapField } from './JsonIntervalMapField';
import { NullableNumberField, ToggleField } from './settings/settings-fields';

export interface CryptoAlgoSettingsEntryTabProps {
  config: CryptoAlgoSettings;
  onChange: (patch: Partial<CryptoAlgoSettings>) => void;
  onJsonValidityChange?: (fieldId: string, valid: boolean) => void;
}

export function CryptoAlgoSettingsEntryTab(props: CryptoAlgoSettingsEntryTabProps) {
  const bandEnabled = () => props.config.cryptoAlgoEntryPriceBandEnabled ?? true;

  return (
    <section class="settings-section settings-section-full">
      <p class="form-hint settings-intro">
        Paramètres d&apos;entrée uniquement (sizing + stratégie). Les sorties SL/TP/trailing
        sont dans l&apos;onglet Sortie.
      </p>

      <h3 class="settings-subheading">Sizing</h3>
      <p class="form-hint settings-intro">
        Dimensionnement des entrées. Plan stop-bleed : ≥ 2× MOS CLOB (shares ou USDC selon le
        mode).
      </p>
      <div class="form-field">
        <label for="crypto-algo-sizing-mode">Mode de sizing</label>
        <select
          id="crypto-algo-sizing-mode"
          value={props.config.cryptoAlgoSizingMode ?? 'fixed_usdc'}
          onChange={(e) =>
            props.onChange({
              cryptoAlgoSizingMode: e.currentTarget.value as 'fixed_usdc' | 'fixed_shares',
            })
          }
        >
          <option value="fixed_usdc">Montant fixe (USDC)</option>
          <option value="fixed_shares">Nombre de parts fixe</option>
        </select>
      </div>
      <Show when={(props.config.cryptoAlgoSizingMode ?? 'fixed_usdc') === 'fixed_usdc'}>
        <div class="form-field">
          <label for="crypto-algo-entry-usdc">Montant entrée (USDC)</label>
          <input
            id="crypto-algo-entry-usdc"
            type="number"
            min={2}
            max={100000}
            value={props.config.cryptoAlgoEntryUsdcAmount ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              props.onChange({
                cryptoAlgoEntryUsdcAmount: v === '' ? undefined : Number(v),
              });
            }}
          />
          <p class="form-hint">Montant USDC par entrée (≥ 2 = 2× MIN_ORDER_USDC).</p>
        </div>
      </Show>
      <Show when={(props.config.cryptoAlgoSizingMode ?? 'fixed_usdc') === 'fixed_shares'}>
        <div class="form-field">
          <label for="crypto-algo-entry-shares">Nombre de parts à l&apos;entrée</label>
          <input
            id="crypto-algo-entry-shares"
            type="number"
            min={2}
            max={1000000}
            value={props.config.cryptoAlgoEntryShareCount ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              props.onChange({
                cryptoAlgoEntryShareCount: v === '' ? undefined : Number(v),
              });
            }}
          />
          <p class="form-hint">Parts par entrée (≥ 2 = 2× MIN_ORDER_SHARES).</p>
        </div>
      </Show>

      <h3 class="settings-subheading">Stratégie (naive-momentum)</h3>
      <p class="form-hint settings-intro">
        Vide = valeur par défaut du code. Les overrides sont rechargés à chaud via Redis
        config-changed.
      </p>
      <ToggleField
        label={bandEnabled() ? 'Price-band entry' : 'Bande d\'entrée activée'}
        checked={bandEnabled()}
        hint={
          bandEnabled()
            ? 'Mode Price-band entry : YES si Up ∈ (min, max), NO si Down ∈ (min, max). Les knobs momentum legacy sont inactifs.'
            : 'Quand activée, remplace le seuil momentum : YES si Up ∈ (min, max), NO si Down ∈ (min, max).'
        }
        onChange={(checked) =>
          props.onChange({ cryptoAlgoEntryPriceBandEnabled: checked })
        }
      />
      <Show when={bandEnabled()}>
        <NullableNumberField
          label="Prix min entrée (exclusif)"
          value={props.config.cryptoAlgoEntryPriceMin}
          min={0.01}
          max={0.98}
          step={0.01}
          placeholder="0.55"
          hint="Prix du token acheté (Up ou Down). Entrée refusée si ≤ cette valeur. Défaut stop-bleed : 0,55."
          onChange={(value) => props.onChange({ cryptoAlgoEntryPriceMin: value })}
        />
        <NullableNumberField
          label="Prix max entrée (exclusif)"
          value={props.config.cryptoAlgoEntryPriceMax}
          min={0.02}
          max={0.99}
          step={0.01}
          placeholder="0.80"
          hint="Prix du token acheté. Entrée refusée si ≥ cette valeur."
          onChange={(value) => props.onChange({ cryptoAlgoEntryPriceMax: value })}
        />
      </Show>
      <ToggleField
        label="Filtre courbe descendante"
        checked={props.config.cryptoAlgoCurveFilterEnabled ?? false}
        hint="Bloque l'entrée si le mid du token acheté baisse, ou si l'historique est insuffisant (fail-closed)."
        onChange={(checked) =>
          props.onChange({ cryptoAlgoCurveFilterEnabled: checked })
        }
      />
      <Show when={props.config.cryptoAlgoCurveFilterEnabled ?? false}>
        <NullableNumberField
          label="Fenêtre courbe (ms)"
          value={props.config.cryptoAlgoCurveLookbackMs}
          min={1000}
          max={60_000}
          step={1000}
          placeholder="10000"
          hint="Durée sur laquelle mesurer la pente du mid (1 000 – 60 000 ms)."
          onChange={(value) => props.onChange({ cryptoAlgoCurveLookbackMs: value })}
        />
        <NullableNumberField
          label="Seuil descente (min delta)"
          value={props.config.cryptoAlgoCurveMinDelta}
          min={0.001}
          max={0.2}
          step={0.001}
          placeholder="0.01"
          hint="Descente bloquante si delta mid < −seuil (points de proba)."
          onChange={(value) => props.onChange({ cryptoAlgoCurveMinDelta: value })}
        />
      </Show>

      <div
        class="settings-legacy-knobs"
        classList={{ 'settings-legacy-knobs--disabled': bandEnabled() }}
        aria-disabled={bandEnabled() ? 'true' : undefined}
      >
        <Show when={bandEnabled()}>
          <p class="form-hint settings-intro">
            Knobs momentum legacy (inactifs tant que Price-band entry est ON).
          </p>
        </Show>
        <NullableNumberField
          label="Seuil de base (threshold)"
          value={props.config.cryptoAlgoBaseThreshold}
          min={0.5}
          max={0.99}
          step={0.01}
          placeholder="0.55"
          disabled={bandEnabled()}
          hint="Ignoré quand Price-band entry est activée. Sinon : prix au-dessus → YES, en dessous de (1 − seuil) → NO."
          onChange={(value) => props.onChange({ cryptoAlgoBaseThreshold: value })}
        />
        <NullableNumberField
          label="Facteur d'ajustement spread"
          value={props.config.cryptoAlgoSpreadAdjustmentFactor}
          min={0}
          max={5}
          step={0.1}
          placeholder="0.5"
          disabled={bandEnabled()}
          hint="adjustedThreshold = base + spreadAbs × facteur (legacy, inactif si bande ON)."
          onChange={(value) => props.onChange({ cryptoAlgoSpreadAdjustmentFactor: value })}
        />
        <NullableNumberField
          label="Spread min pour ajustement"
          value={props.config.cryptoAlgoMinSpreadAbsForAdjustment}
          min={0}
          max={0.5}
          step={0.001}
          placeholder="0.01"
          disabled={bandEnabled()}
          onChange={(value) =>
            props.onChange({ cryptoAlgoMinSpreadAbsForAdjustment: value })
          }
        />
      </div>

      <NullableNumberField
        label="Spread max (intervalle inconnu)"
        value={props.config.cryptoAlgoMaxSpreadAbs}
        min={0.001}
        max={0.5}
        step={0.001}
        placeholder="0.02"
        onChange={(value) => props.onChange({ cryptoAlgoMaxSpreadAbs: value })}
      />
      <NullableNumberField
        label="Tolérance somme YES+NO (Gamma)"
        value={props.config.cryptoAlgoPriceSumTolerance}
        min={0.001}
        max={0.2}
        step={0.001}
        placeholder="0.02"
        onChange={(value) => props.onChange({ cryptoAlgoPriceSumTolerance: value })}
      />
      <NullableNumberField
        label="Écart WS/Gamma (warn)"
        value={props.config.cryptoAlgoWarnPriceDeviation}
        min={0.01}
        max={0.5}
        step={0.01}
        placeholder="0.05"
        onChange={(value) => props.onChange({ cryptoAlgoWarnPriceDeviation: value })}
      />
      <NullableNumberField
        label="Âge max carnet WS (ms)"
        value={props.config.cryptoAlgoMaxBookAgeMs}
        min={1000}
        max={300_000}
        step={1000}
        placeholder="15000"
        onChange={(value) => props.onChange({ cryptoAlgoMaxBookAgeMs: value })}
      />
      <JsonIntervalMapField
        label="Spread absolu max par intervalle (JSON)"
        hint="Merge partiel : seules les clés présentes remplacent les defaults code. Vide = table code."
        placeholder={JSON.stringify(CODE_DEFAULT_SPREAD_ABS_BY_INTERVAL, null, 2)}
        value={props.config.cryptoAlgoSpreadAbsByInterval as Record<string, unknown> | null}
        valueKind="number"
        onValidityChange={(valid) =>
          props.onJsonValidityChange?.('cryptoAlgoSpreadAbsByInterval', valid)
        }
        onChange={(value) =>
          props.onChange({
            cryptoAlgoSpreadAbsByInterval: value as Record<string, number> | null,
          })
        }
      />

      <h3 class="settings-subheading">Re-entrée</h3>
      <NullableNumberField
        label="Fenêtre re-entrée (ms)"
        value={props.config.cryptoAlgoReentryWindowMs}
        min={1}
        max={86_400_000}
        step={1000}
        placeholder="auto (durée intervalle marché)"
        hint="Vide = durée de l'intervalle du marché (ex. 5m → 300 000 ms), sinon 1 h."
        onChange={(value) => props.onChange({ cryptoAlgoReentryWindowMs: value })}
      />
      <NullableNumberField
        label="Max entrées / fenêtre"
        value={props.config.cryptoAlgoMaxEntriesPerWindow}
        min={1}
        max={20}
        step={1}
        placeholder="1"
        onChange={(value) => props.onChange({ cryptoAlgoMaxEntriesPerWindow: value })}
      />
    </section>
  );
}
