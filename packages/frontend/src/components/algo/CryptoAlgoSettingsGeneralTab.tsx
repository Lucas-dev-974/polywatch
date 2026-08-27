import { For, Show } from 'solid-js';
import type { CryptoAlgoSettings } from '../settings/crypto-algo-settings-types';
import { NumberField, NullableNumberField, ToggleField } from '../settings/settings-fields';

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
        Kill-switch, stratégies actives et infra worker. Sizing / entrée → onglet Entrée ;
        SL/TP/trailing → onglet Sortie.
      </p>
      <ToggleField
        label="Activer le crypto algo (kill-switch)"
        checked={props.config.cryptoAlgoEnabled}
        hint="Active ou désactive globalement le worker de trading algorithmique crypto."
        onChange={(checked) => props.onChange({ cryptoAlgoEnabled: checked })}
      />
      <ToggleField
        label="Enregistrer & écouter les marchés"
        checked={props.config.cryptoAlgoRecordingEnabled}
        hint="OFF : coupe l'abonnement temps réel et tout enregistrement (ticks, surveillance) sur les marchés crypto-algo. Les données existantes sont conservées."
        onChange={(checked) =>
          props.onChange({ cryptoAlgoRecordingEnabled: checked })
        }
      />
      <div class="form-field">
        <label>Stratégies activées (catalogue)</label>
        <p class="form-hint">
          Ordre = priorité d&apos;évaluation (first-wins). Une seule stratégie active à la fois
          recommandé en sim.
        </p>
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
        hint="OFF recommandé pour backtest (stop-bleed Phase 0) : exportez avant de réactiver. Supprime périodiquement les anciens AlgoPriceTick."
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

      <h3 class="settings-subheading">Quota SL par marché</h3>
      <p class="form-hint settings-intro">
        Limite les sorties SL sur un même marché et bloque toute nouvelle entrée
        (YES et NO) une fois le quota atteint.
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
          onChange={(value) => props.onChange({ cryptoAlgoSlQuotaPerMarket: value })}
        />
        <NullableNumberField
          label="Cache compteur SL (secondes)"
          value={props.config.cryptoAlgoSlQuotaCacheTtlSeconds}
          min={5}
          max={600}
          step={5}
          placeholder="30"
          onChange={(value) => props.onChange({ cryptoAlgoSlQuotaCacheTtlSeconds: value })}
        />
      </Show>
    </section>
  );
}
