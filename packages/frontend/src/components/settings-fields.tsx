import { Show } from 'solid-js';
import type { EnvMode, EnvSettings } from './env-settings-types';
import { modeSettingKey } from './env-settings-types';

export function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div class="form-field">
      <label class="toggle-switch">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span class="toggle-track" />
        <span class="toggle-label">{props.label}</span>
      </label>
      <Show when={props.hint}>
        <p class="form-hint">{props.hint}</p>
      </Show>
    </div>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number | string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div class="form-field">
      <label>{props.label}</label>
      <input
        class="input"
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <Show when={props.hint}>
        <p class="form-hint">{props.hint}</p>
      </Show>
    </div>
  );
}

/** Nullable percent/seconds field: empty = null (auto), 0 = explicit zero, >0 = override. */
export function NullableNumberField(props: {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number | string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div class="form-field" classList={{ 'form-field--disabled': !!props.disabled }}>
      <label>{props.label}</label>
      <input
        class="input"
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        placeholder={props.placeholder}
        disabled={props.disabled}
        value={props.value ?? ''}
        onInput={(e) => {
          if (props.disabled) return;
          const raw = e.currentTarget.value.trim();
          if (raw === '') {
            props.onChange(null);
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          props.onChange(parsed);
        }}
      />
      <Show when={props.hint}>
        <p class="form-hint">{props.hint}</p>
      </Show>
    </div>
  );
}

export function SimInitialCapitalField(props: {
  value: number;
  onChange: (simInitialCapital: number) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <NumberField
      label={props.label ?? 'Capital initial (pUSD)'}
      value={props.value}
      min={0.01}
      step={0.01}
      hint={
        props.hint ??
        'Montant restauré lors de la réinitialisation de la simulation pour cet algo.'
      }
      onChange={props.onChange}
    />
  );
}

export function KillSwitchField(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div class="form-field">
      <label>Kill switch</label>
      <select
        class="select"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <option value="block_entries">Bloquer entrées</option>
        <option value="force_close_all">Fermer tout</option>
        <option value="block_and_notify">Bloquer + notifier</option>
      </select>
    </div>
  );
}

export function PositionAdjustmentsSection(props: {
  prefix: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  const increaseKey = modeSettingKey(props.prefix, 'CopyIncreaseEnabled');
  const decreaseKey = modeSettingKey(props.prefix, 'CopyDecreaseEnabled');
  const maxKey = modeSettingKey(props.prefix, 'MaxIncreasesPerPosition');
  const proximityEnabledKey = modeSettingKey(
    props.prefix,
    'CopyIncreaseSlProximityEnabled',
  );
  const proximityPercentKey = modeSettingKey(
    props.prefix,
    'CopyIncreaseSlProximityPercent',
  );

  return (
    <section class="settings-section settings-section-full">
      <h3 class="settings-section-title">Ajustements de position</h3>
      <ToggleField
        label="Copier les augmentations (INCREASED)"
        checked={props.config[increaseKey]}
        onChange={(checked) => props.onChange({ [increaseKey]: checked })}
      />
      <ToggleField
        label="Copier les réductions (DECREASED)"
        checked={props.config[decreaseKey]}
        onChange={(checked) => props.onChange({ [decreaseKey]: checked })}
      />
      <NumberField
        label="Max augmentations par position"
        value={props.config[maxKey]}
        min={0}
        step={1}
        hint="0 = illimité. Les fermetures (CLOSED) restent toujours copiées."
        onChange={(value) => props.onChange({ [maxKey]: value })}
      />
      <ToggleField
        label="Bloquer l'augmentation près du stop-loss"
        checked={props.config[proximityEnabledKey]}
        hint="Rejette les INCREASED si la position est déjà proche de son SL configuré."
        onChange={(checked) =>
          props.onChange({ [proximityEnabledKey]: checked })
        }
      />
      <Show when={props.config[proximityEnabledKey]}>
        <NumberField
          label="Seuil de proximité SL (%)"
          value={props.config[proximityPercentKey]}
          min={0}
          max={100}
          step={1}
          hint="Pourcentage du SL à partir duquel les augmentations sont bloquées (ex. 80 = bloquer si perte > 80% du SL)."
          onChange={(value) =>
            props.onChange({
              [proximityPercentKey]: Math.min(100, Math.max(0, value)),
            })
          }
        />
      </Show>
    </section>
  );
}

export function SimAutoSnapshotSection(props: {
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  return (
    <section class="settings-section settings-section-full">
      <h3 class="settings-section-title">Snapshots automatiques</h3>
      <ToggleField
        label="Enregistrer un snapshot périodique"
        checked={props.config.simAutoSnapshotEnabled}
        hint="Crée un snapshot de l'état simulation à intervalle régulier (si la session a de l'activité)."
        onChange={(checked) =>
          props.onChange({ simAutoSnapshotEnabled: checked })
        }
      />
      <Show when={props.config.simAutoSnapshotEnabled}>
        <NumberField
          label="Intervalle (minutes)"
          value={props.config.simAutoSnapshotIntervalSeconds / 60}
          min={1}
          step={1}
          hint="Minimum 1 minute. Utile pour suivre l'évolution equity/PnL sans action manuelle."
          onChange={(minutes) =>
            props.onChange({
              simAutoSnapshotIntervalSeconds: Math.max(60, minutes * 60),
            })
          }
        />
        <NumberField
          label="Rétention (jours, optionnel)"
          value={props.config.simSnapshotRetentionDays ?? 0}
          min={0}
          step={1}
          hint="Supprime les snapshots plus anciens que N jours. 0 = désactivé."
          onChange={(days) =>
            props.onChange({
              simSnapshotRetentionDays: days > 0 ? days : null,
            })
          }
        />
        <NumberField
          label="Max snapshots (optionnel)"
          value={props.config.simSnapshotMaxCount ?? 0}
          min={0}
          step={1}
          hint="Garde seulement les N snapshots les plus récents. 0 = désactivé."
          onChange={(count) =>
            props.onChange({
              simSnapshotMaxCount: count > 0 ? count : null,
            })
          }
        />
      </Show>
    </section>
  );
}

export function RealAutoSnapshotSection(props: {
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  return (
    <section class="settings-section settings-section-full">
      <h3 class="settings-section-title">Snapshots automatiques (réel)</h3>
      <ToggleField
        label="Enregistrer un snapshot périodique"
        checked={props.config.realAutoSnapshotEnabled}
        hint="Crée un snapshot observationnel à intervalle régulier (si la période a de l'activité)."
        onChange={(checked) =>
          props.onChange({ realAutoSnapshotEnabled: checked })
        }
      />
      <Show when={props.config.realAutoSnapshotEnabled}>
        <NumberField
          label="Intervalle (minutes)"
          value={props.config.realAutoSnapshotIntervalSeconds / 60}
          min={1}
          step={1}
          hint="Minimum 1 minute. Nécessite un wallet accessible."
          onChange={(minutes) =>
            props.onChange({
              realAutoSnapshotIntervalSeconds: Math.max(60, minutes * 60),
            })
          }
        />
        <NumberField
          label="Rétention (jours, optionnel)"
          value={props.config.realSnapshotRetentionDays ?? 0}
          min={0}
          step={1}
          hint="Supprime les snapshots plus anciens que N jours. 0 = désactivé."
          onChange={(days) =>
            props.onChange({
              realSnapshotRetentionDays: days > 0 ? days : null,
            })
          }
        />
        <NumberField
          label="Max snapshots (optionnel)"
          value={props.config.realSnapshotMaxCount ?? 0}
          min={0}
          step={1}
          hint="Garde seulement les N snapshots les plus récents. 0 = désactivé."
          onChange={(count) =>
            props.onChange({
              realSnapshotMaxCount: count > 0 ? count : null,
            })
          }
        />
      </Show>
    </section>
  );
}

export function PreCloseSection(props: {
  prefix: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
  fullWidth?: boolean;
}) {
  const enabledKey = modeSettingKey(props.prefix, 'PreCloseEnabled');
  const secondsKey = modeSettingKey(props.prefix, 'PreCloseSeconds');
  const keepEnabledKey = modeSettingKey(props.prefix, 'PreCloseKeepEnabled');
  const keepBidThresholdKey = modeSettingKey(props.prefix, 'PreCloseKeepBidThreshold');

  return (
    <section
      class="settings-section"
      classList={{ 'settings-section-full': props.fullWidth !== false }}
    >
      <h3 class="settings-section-title">Pré-clôture</h3>
      <ToggleField
        label="Pré-clôture avant fin de marché"
        checked={props.config[enabledKey]}
        onChange={(checked) => props.onChange({ [enabledKey]: checked })}
      />
      <Show when={props.config[enabledKey]}>
        <div class="settings-grid">
          <NumberField
            label="Délai avant fin (secondes)"
            value={props.config[secondsKey]}
            min={1}
            step={1}
            onChange={(value) => props.onChange({ [secondsKey]: value })}
          />
          <ToggleField
            label="Conserver si position gagnante"
            checked={props.config[keepEnabledKey]}
            hint="Si activé, les positions dont le bid est au-dessus du seuil Keep restent ouvertes jusqu'à la résolution."
            onChange={(checked) => props.onChange({ [keepEnabledKey]: checked })}
          />
          <Show when={props.config[keepEnabledKey]}>
            <NumberField
              label="Seuil Keep (bid)"
              value={props.config[keepBidThresholdKey]}
              min={0}
              max={1}
              step={0.01}
              hint="Bid minimum pour conserver une position gagnante. Ex. 0.80 = conserver si bid ≥ 0.80."
              onChange={(value) =>
                props.onChange({
                  [keepBidThresholdKey]: Math.min(1, Math.max(0, value)),
                })
              }
            />
          </Show>
        </div>
      </Show>
    </section>
  );
}
