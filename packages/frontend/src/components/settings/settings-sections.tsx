import { For, Show } from 'solid-js';
import type { EnvMode, EnvSettings, SizingMode } from './env-settings-types';
import { ENV_MODE_LABELS, modeSettingKey } from './env-settings-types';
import {
  KillSwitchField,
  NumberField,
  ToggleField,
} from './settings-fields';

const SIZING_MODE_LABELS: Record<SizingMode, string> = {
  fixed_pusd: 'Montant fixe (pUSD)',
  fixed_shares: 'Nombre fixe de shares',
  fixed_ratio: 'Ratio du trader',
  proportional_capital: 'Proportionnel au capital',
  kelly_fractional: 'Kelly fractionnel',
  risk_based: 'Budget de risque',
};

function SizingField(props: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      hint={props.hint}
      onChange={props.onChange}
    />
  );
}

export function SizingSection(props: {
  prefix: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
  showTitle?: boolean;
  sectionTitle?: string;
}) {
  const modeKey = modeSettingKey(props.prefix, 'SizingMode');
  const ratioKey = modeSettingKey(props.prefix, 'CopyRatio');
  const amountKey = modeSettingKey(props.prefix, 'EntryPusdAmount');
  const shareCountKey = modeSettingKey(props.prefix, 'EntryShareCount');
  const kellyFractionKey = modeSettingKey(props.prefix, 'KellyFraction');
  const riskBudgetKey = modeSettingKey(props.prefix, 'RiskBudgetPusd');
  const winProbKey = modeSettingKey(props.prefix, 'DefaultWinProbability');
  const signalScoreKey = modeSettingKey(props.prefix, 'SignalScoreSizingEnabled');
  const mode = () => props.config[modeKey];
  const title = ENV_MODE_LABELS[props.prefix];

  return (
    <section class="settings-section">
      <Show when={props.sectionTitle != null || props.showTitle !== false}>
        <h3 class="settings-section-title">
          {props.sectionTitle ?? title}
        </h3>
      </Show>
      <div class="form-field">
        <label>Mode de sizing</label>
        <select
          class="select"
          value={mode()}
          onChange={(e) => {
            const nextMode = e.currentTarget.value as SizingMode;
            const patch: Partial<EnvSettings> = { [modeKey]: nextMode };
            if (nextMode === 'fixed_pusd' && props.config[amountKey] <= 0) {
              patch[amountKey] = 10;
            }
            if (nextMode === 'fixed_shares' && props.config[shareCountKey] <= 0) {
              patch[shareCountKey] = 5;
            }
            props.onChange(patch);
          }}
        >
          <For each={Object.entries(SIZING_MODE_LABELS)}>
            {([value, text]) => <option value={value}>{text}</option>}
          </For>
        </select>
      </div>
      <ToggleField
        label="Adapter la mise au score du signal"
        checked={props.config[signalScoreKey]}
        hint="Si activé, la mise est multipliée par un score qualité (spread, échéance…). Désactivez pour appliquer le montant sizing brut (ex. montant fixe exact)."
        onChange={(checked) => props.onChange({ [signalScoreKey]: checked })}
      />
      <Show when={mode() === 'fixed_pusd'}>
        <SizingField
          label="Montant par entrée (pUSD)"
          value={props.config[amountKey]}
          min={0.01}
          step={0.01}
          onChange={(value) => props.onChange({ [amountKey]: value })}
        />
      </Show>
      <Show when={mode() === 'fixed_shares'}>
        <SizingField
          label="Shares par entrée"
          value={props.config[shareCountKey]}
          min={1}
          step={1}
          hint="Nombre de shares achetés à chaque entrée (OPEN/INCREASE), indépendamment du prix. Le coût varie (N × prix). En réel, N × ask doit être ≥ 1 pUSD. Le MOS marché peut augmenter la quantité si elle est sous le minimum."
          onChange={(value) => props.onChange({ [shareCountKey]: value })}
        />
      </Show>
      <Show when={mode() === 'fixed_ratio'}>
        <SizingField
          label="Ratio de copie (× taille trader)"
          value={props.config[ratioKey]}
          min={0.01}
          step={0.01}
          onChange={(value) => props.onChange({ [ratioKey]: value })}
        />
      </Show>
      <Show when={mode() === 'proportional_capital'}>
        <p class="form-hint">
          Taille = (votre balance / balance trader) × delta du trader.
        </p>
      </Show>
      <Show when={mode() === 'kelly_fractional'}>
        <SizingField
          label="Fraction Kelly (0..1)"
          value={props.config[kellyFractionKey]}
          min={0.01}
          max={1}
          step={0.01}
          hint="1.0 = Kelly plein. 0.25 recommandé pour réduire la volatilité."
          onChange={(value) => props.onChange({ [kellyFractionKey]: value })}
        />
        <SizingField
          label="Probabilité de gain estimée"
          value={props.config[winProbKey]}
          min={0.01}
          max={0.99}
          step={0.01}
          hint="Utilisée par la formule Kelly. 0.55 = léger edge."
          onChange={(value) => props.onChange({ [winProbKey]: value })}
        />
      </Show>
      <Show when={mode() === 'risk_based'}>
        <SizingField
          label="Budget de risque par trade (pUSD)"
          value={props.config[riskBudgetKey]}
          min={0.01}
          step={0.01}
          hint="Montant maximum que vous acceptez de perdre sur ce trade, basé sur la distance au SL."
          onChange={(value) => props.onChange({ [riskBudgetKey]: value })}
        />
      </Show>
    </section>
  );
}

export function ExitSection(props: {
  prefix: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
  showTitle?: boolean;
  sectionTitle?: string;
}) {
  const slEnabledKey = modeSettingKey(props.prefix, 'SlEnabled');
  const tpEnabledKey = modeSettingKey(props.prefix, 'TpEnabled');
  const slPercentKey = modeSettingKey(props.prefix, 'SlPercent');
  const slCloseRetriesKey = modeSettingKey(props.prefix, 'SlCloseMaxRetries');
  const tpPercentKey = modeSettingKey(props.prefix, 'TpPercent');
  const trailingEnabledKey = modeSettingKey(props.prefix, 'TrailingEnabled');
  const trailingPercentKey = modeSettingKey(props.prefix, 'TrailingPercent');
  const trailingActivationPercentKey = modeSettingKey(
    props.prefix,
    'TrailingActivationPercent',
  );
  const title = ENV_MODE_LABELS[props.prefix];

  return (
    <section class="settings-section">
      <Show when={props.sectionTitle != null || props.showTitle !== false}>
        <h3 class="settings-section-title">
          {props.sectionTitle ?? title}
        </h3>
      </Show>
      <ToggleField
        label="Stop Loss"
        checked={props.config[slEnabledKey]}
        onChange={(checked) => props.onChange({ [slEnabledKey]: checked })}
      />
      <Show when={props.config[slEnabledKey]}>
        <NumberField
          label="Stop Loss (% de la mise)"
          value={props.config[slPercentKey]}
          min={0.1}
          step={0.5}
          hint="20 = déclenche le SL quand le PnL de clôture atteint -20% de la mise investie."
          onChange={(value) => props.onChange({ [slPercentKey]: value })}
        />
        <NumberField
          label="Retries fermeture SL"
          value={props.config[slCloseRetriesKey]}
          min={0}
          step={1}
          hint="Nombre de nouvelles tentatives si la vente SL échoue faute de liquidité (bid requis, sim = réel)."
          onChange={(value) => props.onChange({ [slCloseRetriesKey]: value })}
        />
        <NumberField
          label="Confirmations SL (ticks)"
          value={props.config.slConfirmationTicks}
          min={1}
          max={10}
          step={1}
          hint="Nombre d'évaluations consécutives sous le seuil SL avant fermeture. 1 = pas de confirmation (comportement legacy). 2+ évite les faux positifs sur micro-pics de liquidité."
          onChange={(value) =>
            props.onChange({ slConfirmationTicks: value })
          }
        />
      </Show>
      <ToggleField
        label="Take Profit"
        checked={props.config[tpEnabledKey]}
        onChange={(checked) => props.onChange({ [tpEnabledKey]: checked })}
      />
      <Show when={props.config[tpEnabledKey]}>
        <NumberField
          label="Take Profit (% de la mise)"
          value={props.config[tpPercentKey]}
          min={0.1}
          step={0.5}
          hint="25 = déclenche le TP quand le PnL de clôture atteint +25% de la mise investie."
          onChange={(value) => props.onChange({ [tpPercentKey]: value })}
        />
      </Show>
      <ToggleField
        label="Trailing stop"
        checked={props.config[trailingEnabledKey]}
        onChange={(checked) =>
          props.onChange({ [trailingEnabledKey]: checked })
        }
      />
      <Show when={props.config[trailingEnabledKey]}>
        <NumberField
          label="Trailing (% de la mise)"
          value={props.config[trailingPercentKey]}
          min={0}
          max={100}
          step={1}
          hint="10 = trailing activé quand le PnL de clôture redescend de 10 points de pourcentage sous son pic."
          onChange={(value) =>
            props.onChange({ [trailingPercentKey]: value })
          }
        />
        <NumberField
          label="Activation trailing (% de la mise)"
          value={props.config[trailingActivationPercentKey]}
          min={0}
          max={100}
          step={1}
          hint="Le trailing ne s'arme qu'une fois le PnL marché ≥ ce seuil en % de la mise. 0 = actif dès l'ouverture."
          onChange={(value) =>
            props.onChange({ [trailingActivationPercentKey]: value })
          }
        />
      </Show>
    </section>
  );
}

export function RiskSection(props: {
  prefix: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  const maxOpenKey = modeSettingKey(props.prefix, 'MaxOpenPositions');
  const maxExposureKey = modeSettingKey(props.prefix, 'MaxExposurePusd');
  const maxDailyLossKey = modeSettingKey(props.prefix, 'MaxDailyLossPusd');
  const killSwitchKey = modeSettingKey(props.prefix, 'KillSwitchAction');

  return (
    <div class="settings-fields-grid">
      <NumberField
        label="Max positions ouvertes"
        value={props.config[maxOpenKey]}
        min={1}
        step={1}
        onChange={(value) => props.onChange({ [maxOpenKey]: value })}
      />
      <NumberField
        label="Max exposition (pUSD)"
        value={props.config[maxExposureKey]}
        min={0.01}
        step={0.01}
        onChange={(value) => props.onChange({ [maxExposureKey]: value })}
      />
      <NumberField
        label="Max perte journalière (pUSD)"
        value={props.config[maxDailyLossKey]}
        min={0.01}
        step={0.01}
        onChange={(value) => props.onChange({ [maxDailyLossKey]: value })}
      />
      <NumberField
        label="Glissement max entrée (%)"
        value={props.config.maxSlippagePercent}
        min={0}
        step={0.1}
        hint="Global : s'applique au copy trading et au crypto algo, en simulation et réel. Un écart fill vs prix de référence supérieur à ce seuil refuse l'ordre."
        onChange={(value) => props.onChange({ maxSlippagePercent: value })}
      />
      <KillSwitchField
        value={props.config[killSwitchKey]}
        onChange={(value) => props.onChange({ [killSwitchKey]: value })}
      />
    </div>
  );
}
