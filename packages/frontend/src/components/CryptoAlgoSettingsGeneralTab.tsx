import { For, Show } from 'solid-js';
import {
  CODE_DEFAULT_SPREAD_ABS_BY_INTERVAL,
  type CryptoAlgoSettings,
} from './crypto-algo-settings-types';
import { JsonIntervalMapField } from './JsonIntervalMapField';
import { NumberField, NullableNumberField, ToggleField } from './settings-fields';

const CRYPTO_ALGO_STRATEGIES: { id: string; label: string }[] = [
  { id: 'naive-momentum', label: 'Naive Momentum' },
];

export interface CryptoAlgoSettingsGeneralTabProps {
  config: CryptoAlgoSettings;
  onChange: (patch: Partial<CryptoAlgoSettings>) => void;
  onJsonValidityChange?: (fieldId: string, valid: boolean) => void;
}

export function CryptoAlgoSettingsGeneralTab(props: CryptoAlgoSettingsGeneralTabProps) {
  return (
    <section class="settings-section settings-section-full">
      <p class="form-hint settings-intro">
        Kill-switch, stratégies et paramètres du worker de trading algorithmique crypto.
      </p>
      <ToggleField
        label="Activer le crypto algo (kill-switch)"
        checked={props.config.cryptoAlgoEnabled}
        hint="Active ou désactive globalement le worker de trading algorithmique crypto."
        onChange={(checked) => props.onChange({ cryptoAlgoEnabled: checked })}
      />
      <div class="form-field">
        <label>Stratégies activées</label>
        <div class="settings-checkbox-group">
          <For each={CRYPTO_ALGO_STRATEGIES}>
            {(strategy) => (
              <label class="checkbox-tag">
                <input
                  type="checkbox"
                  checked={props.config.cryptoAlgoStrategies.includes(strategy.id)}
                  onChange={(e) => {
                    const current = props.config.cryptoAlgoStrategies;
                    const next = e.currentTarget.checked
                      ? [...current, strategy.id]
                      : current.filter((s) => s !== strategy.id);
                    props.onChange({ cryptoAlgoStrategies: next });
                  }}
                />
                <span>{strategy.label}</span>
              </label>
            )}
          </For>
        </div>
      </div>
      <NumberField
        label="Glissement max entrée (%)"
        value={props.config.maxSlippagePercent}
        min={0}
        step={0.1}
        hint="Global : s'applique aussi au copy trading, en simulation et réel. Un écart fill vs prix de référence supérieur à ce seuil refuse l'ordre."
        onChange={(value) => props.onChange({ maxSlippagePercent: value })}
      />
      <ToggleField
        label="Nettoyage automatique des ticks de prix"
        checked={props.config.cryptoAlgoPriceTickCleanupEnabled}
        hint="Supprime périodiquement les anciens ticks de prix (AlgoPriceTick) pour limiter l'utilisation disque."
        onChange={(checked) => props.onChange({ cryptoAlgoPriceTickCleanupEnabled: checked })}
      />
      {props.config.cryptoAlgoPriceTickCleanupEnabled && (
        <div class="form-field">
          <label for="cleanup-interval">Intervalle de nettoyage (minutes)</label>
          <input
            id="cleanup-interval"
            type="number"
            min={1}
            max={1440}
            value={props.config.cryptoAlgoPriceTickCleanupIntervalMinutes}
            onChange={(e) =>
              props.onChange({
                cryptoAlgoPriceTickCleanupIntervalMinutes: Math.max(
                  1,
                  Math.min(1440, Number(e.currentTarget.value) || 60),
                ),
              })
            }
          />
          <p class="form-hint">
            Rétention configurable via « Rétention ticks » ci-dessous. Intervalle recommandé : 60 min.
          </p>
        </div>
      )}

      <h3 class="settings-subheading">Sizing</h3>
      <p class="form-hint settings-intro">
        Mode de dimensionnement des entrées pour le trading algorithmique crypto.
      </p>
      <div class="form-field">
        <label for="crypto-algo-sizing-mode">Mode de sizing</label>
        <select
          id="crypto-algo-sizing-mode"
          value={props.config.cryptoAlgoSizingMode ?? 'fixed_usdc'}
          onChange={(e) =>
            props.onChange({ cryptoAlgoSizingMode: e.currentTarget.value as 'fixed_usdc' | 'fixed_shares' })
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
            min={1}
            max={100000}
            value={props.config.cryptoAlgoEntryUsdcAmount ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              props.onChange({
                cryptoAlgoEntryUsdcAmount: v === '' ? undefined : Number(v),
              });
            }}
          />
          <p class="form-hint">Montant en USDC par entrée (1 – 100 000).</p>
        </div>
      </Show>
      <Show when={(props.config.cryptoAlgoSizingMode ?? 'fixed_usdc') === 'fixed_shares'}>
        <div class="form-field">
          <label for="crypto-algo-entry-shares">Nombre de parts à l'entrée</label>
          <input
            id="crypto-algo-entry-shares"
            type="number"
            min={1}
            max={1000000}
            value={props.config.cryptoAlgoEntryShareCount ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              props.onChange({
                cryptoAlgoEntryShareCount: v === '' ? undefined : Number(v),
              });
            }}
          />
          <p class="form-hint">Nombre de parts par entrée (1 – 1 000 000).</p>
        </div>
      </Show>

      <h3 class="settings-subheading">Stratégie (naive-momentum)</h3>
      <p class="form-hint settings-intro">
        Vide = valeur par défaut du code. Les overrides sont rechargés à chaud via Redis config-changed.
      </p>
      <ToggleField
        label="Bande d'entrée activée"
        checked={props.config.cryptoAlgoEntryPriceBandEnabled ?? true}
        hint="Quand activée, remplace le seuil momentum : YES si Up ∈ (min, max), NO si Down ∈ (min, max)."
        onChange={(checked) =>
          props.onChange({ cryptoAlgoEntryPriceBandEnabled: checked })
        }
      />
      <Show when={props.config.cryptoAlgoEntryPriceBandEnabled ?? true}>
        <NullableNumberField
          label="Prix min entrée (exclusif)"
          value={props.config.cryptoAlgoEntryPriceMin}
          min={0.01}
          max={0.98}
          step={0.01}
          placeholder="0.50"
          hint="Prix du token acheté (Up ou Down). Entrée refusée si ≤ cette valeur."
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
        hint="Bloque l'entrée si le mid du token acheté (Up pour YES, Down pour NO) baisse sur la fenêtre. Flat et montée autorisés. Nécessite le carnet WS — prévoir ~lookback de warm-up après activation."
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
          hint="Durée sur laquelle mesurer la pente du mid (1 000 – 60 000 ms, max = buffer WS)."
          onChange={(value) => props.onChange({ cryptoAlgoCurveLookbackMs: value })}
        />
        <NullableNumberField
          label="Seuil descente (min delta)"
          value={props.config.cryptoAlgoCurveMinDelta}
          min={0.001}
          max={0.2}
          step={0.001}
          placeholder="0.01"
          hint="Descente bloquante si delta mid < −seuil (points de proba). Ex. 0.01 = −1 pt."
          onChange={(value) => props.onChange({ cryptoAlgoCurveMinDelta: value })}
        />
      </Show>
      <NullableNumberField
        label="Seuil de base (threshold)"
        value={props.config.cryptoAlgoBaseThreshold}
        min={0.5}
        max={0.99}
        step={0.01}
        placeholder="0.55"
        hint="Ignoré quand la bande d'entrée est activée. Sinon : prix au-dessus → YES, en dessous de (1 − seuil) → NO."
        onChange={(value) => props.onChange({ cryptoAlgoBaseThreshold: value })}
      />
      <NullableNumberField
        label="Facteur d'ajustement spread"
        value={props.config.cryptoAlgoSpreadAdjustmentFactor}
        min={0}
        max={5}
        step={0.1}
        placeholder="0.5"
        hint="adjustedThreshold = base + spreadAbs × facteur"
        onChange={(value) => props.onChange({ cryptoAlgoSpreadAdjustmentFactor: value })}
      />
      <NullableNumberField
        label="Spread min pour ajustement"
        value={props.config.cryptoAlgoMinSpreadAbsForAdjustment}
        min={0}
        max={0.5}
        step={0.001}
        placeholder="0.01"
        onChange={(value) =>
          props.onChange({ cryptoAlgoMinSpreadAbsForAdjustment: value })
        }
      />
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

      <h3 class="settings-subheading">Fraîcheur & timing</h3>
      <NullableNumberField
        label="TTL cache Gamma court (≤15m, ms)"
        value={props.config.cryptoAlgoGammaCacheTtlShortMs}
        min={1000}
        max={300_000}
        step={1000}
        placeholder="10000"
        onChange={(value) => props.onChange({ cryptoAlgoGammaCacheTtlShortMs: value })}
      />
      <NullableNumberField
        label="TTL cache Gamma défaut (ms)"
        value={props.config.cryptoAlgoGammaCacheTtlDefaultMs}
        min={1000}
        max={600_000}
        step={1000}
        placeholder="30000"
        onChange={(value) => props.onChange({ cryptoAlgoGammaCacheTtlDefaultMs: value })}
      />
      <NullableNumberField
        label="Facteur stale-on-error Gamma"
        value={props.config.cryptoAlgoGammaStaleOnErrorFactor}
        min={1}
        max={10}
        step={0.5}
        placeholder="2"
        onChange={(value) =>
          props.onChange({ cryptoAlgoGammaStaleOnErrorFactor: value })
        }
      />
      <NullableNumberField
        label="Debounce WS (ms)"
        value={props.config.cryptoAlgoWsDebounceMs}
        min={0}
        max={60_000}
        step={500}
        placeholder="5000"
        onChange={(value) => props.onChange({ cryptoAlgoWsDebounceMs: value })}
      />
      <NullableNumberField
        label="Poll fallback (ms)"
        value={props.config.cryptoAlgoPollMs}
        min={1000}
        max={600_000}
        step={1000}
        placeholder="30000"
        hint="Complète CRYPTO_ALGO_POLL_MS env quand vide."
        onChange={(value) => props.onChange({ cryptoAlgoPollMs: value })}
      />
      <NullableNumberField
        label="Intervalle ticks prix (ms)"
        value={props.config.cryptoAlgoTickIntervalMs}
        min={100}
        max={60_000}
        step={100}
        placeholder="1000"
        onChange={(value) => props.onChange({ cryptoAlgoTickIntervalMs: value })}
      />
      <NullableNumberField
        label="Rétention ticks (heures)"
        value={props.config.cryptoAlgoTickRetentionHours}
        min={1}
        max={720}
        step={1}
        placeholder="24"
        onChange={(value) => props.onChange({ cryptoAlgoTickRetentionHours: value })}
      />
      <NullableNumberField
        label="Ref qty VWAP ticks"
        value={props.config.cryptoAlgoPriceTickRefQty}
        min={1}
        max={10_000}
        step={1}
        placeholder="50"
        onChange={(value) => props.onChange({ cryptoAlgoPriceTickRefQty: value })}
      />

      <h3 class="settings-subheading">Re-entrée</h3>
      <p class="form-hint settings-intro">
        Limite les entrées répétées sur le même marché. Seul un enqueue réussi consomme un slot.
        YES et NO sont comptés séparément.
      </p>
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
        hint="Nombre max d'entrées enqueued par outcome (YES/NO) dans la fenêtre."
        onChange={(value) => props.onChange({ cryptoAlgoMaxEntriesPerWindow: value })}
      />

      <h3 class="settings-subheading">Quota SL par marché</h3>
      <p class="form-hint settings-intro">
        Limite les sorties SL sur un même marché et bloque toute nouvelle entrée
        (YES et NO) une fois le quota atteint. Une seule position algo ouverte à
        la fois par marché quand cette règle est activée.
      </p>
      <ToggleField
        label="Activer le quota SL"
        checked={props.config.cryptoAlgoSlQuotaEnabled}
        hint="Un slot est consommé dès le déclenchement du SL (pas seulement à la clôture finale)."
        onChange={(checked) => props.onChange({ cryptoAlgoSlQuotaEnabled: checked })}
      />
      <Show when={props.config.cryptoAlgoSlQuotaEnabled}>
        <NullableNumberField
          label="Quota max SL par marché"
          value={props.config.cryptoAlgoSlQuotaPerMarket}
          min={1}
          max={20}
          step={1}
          placeholder="1"
          hint="Nombre max de sorties SL déclenchées avant blocage des entrées sur ce marché."
          onChange={(value) => props.onChange({ cryptoAlgoSlQuotaPerMarket: value })}
        />
        <NullableNumberField
          label="Cache compteur SL (secondes)"
          value={props.config.cryptoAlgoSlQuotaCacheTtlSeconds}
          min={5}
          max={600}
          step={5}
          placeholder="30"
          hint="Fréquence de rafraîchissement du compteur SL depuis la DB."
          onChange={(value) => props.onChange({ cryptoAlgoSlQuotaCacheTtlSeconds: value })}
        />
      </Show>
    </section>
  );
}
