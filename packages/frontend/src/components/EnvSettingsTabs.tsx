import { Show } from 'solid-js';
import type { EnvMode, EnvSettings } from './settings/env-settings-types';
import { ENV_MODE_LABELS, modeSettingKey } from './settings/env-settings-types';
import {
  NumberField,
  PositionAdjustmentsSection,
  PreCloseSection,
  SimInitialCapitalField,
  ToggleField,
} from './settings/settings-fields';
import { MarketTagsSection } from './MarketTagsSection';
import { ExitSection, RiskSection, SizingSection } from './settings/settings-sections';

export function SettingsTabIntro(props: { title: string; description: string }) {
  return (
    <div class="settings-tab-intro">
      <h3 class="settings-tab-intro-title">{props.title}</h3>
      <p class="settings-tab-intro-desc">{props.description}</p>
    </div>
  );
}

export function EnvSettingsEntryTab(props: {
  mode: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  const maxPositionKey = modeSettingKey(props.mode, 'MaxPositionSizeUsdc');
  const allowedMarketTagsKey = modeSettingKey(props.mode, 'AllowedMarketTags');

  return (
    <div class="settings-tab-panel" role="tabpanel">
      <SettingsTabIntro
        title="Paramètres d'entrée"
        description={`Taille, filtres et restrictions appliqués à tous les traders copiés en mode ${ENV_MODE_LABELS[props.mode].toLowerCase()}.`}
      />

      <div class="settings-panel-grid">
        <SizingSection
          prefix={props.mode}
          config={props.config}
          onChange={props.onChange}
          showTitle={false}
          sectionTitle="Sizing"
        />

        <section class="settings-section">
          <h3 class="settings-section-title">Limites &amp; filtres</h3>
          <NumberField
            label="Plafond max par position (pUSD)"
            value={props.config[maxPositionKey]}
            min={0.01}
            step={0.01}
            hint="Limite le montant même si le sizing demande plus."
            onChange={(value) =>
              props.onChange({ [maxPositionKey]: value })
            }
          />
          <NumberField
            label="Ratio bid/ask min à l'entrée"
            value={props.config[modeSettingKey(props.mode, 'MinBidToAskRatio')]}
            min={0}
            max={1}
            step={0.01}
            hint="Bid exécutable ÷ ask pour la taille copiée. Ex. 0,90 = le bid doit valoir au moins 90 % de l'ask. 0 = désactivé."
            onChange={(value) =>
              props.onChange({
                [modeSettingKey(props.mode, 'MinBidToAskRatio')]: value,
              })
            }
          />
          <NumberField
            label="Retries profondeur ask (entrée)"
            value={props.config[modeSettingKey(props.mode, 'EntryDepthRetryMax')]}
            min={0}
            step={1}
            hint="Si le carnet ne peut pas remplir toute la taille cible, re-vérifier jusqu'à N fois avant de skip. 0 = une seule tentative."
            onChange={(value) =>
              props.onChange({
                [modeSettingKey(props.mode, 'EntryDepthRetryMax')]: value,
              })
            }
          />
          <NumberField
            label="Délai entre retries profondeur (ms)"
            value={props.config[modeSettingKey(props.mode, 'EntryDepthRetryDelayMs')]}
            min={0}
            step={100}
            hint="Pause entre deux vérifications de profondeur ask (ex. 1000 = 1 seconde)."
            onChange={(value) =>
              props.onChange({
                [modeSettingKey(props.mode, 'EntryDepthRetryDelayMs')]: value,
              })
            }
          />
          <ToggleField
            label="Filtre momentum à l'entrée"
            checked={
              props.config[modeSettingKey(props.mode, 'MomentumFilterEnabled')]
            }
            hint="Refuse de copier une entrée si le prix d'achat est inférieur au prix moyen du trader (position déjà sous l'eau). Sans effet si le prix moyen du trader n'est pas encore disponible."
            onChange={(checked) =>
              props.onChange({
                [modeSettingKey(props.mode, 'MomentumFilterEnabled')]: checked,
              })
            }
          />
          <NumberField
            label="Ne pas entrer si le marché se ferme dans moins de (minutes)"
            value={
              props.config[modeSettingKey(props.mode, 'MinTimeToClose')] / 60
            }
            min={0}
            step={1}
            hint="0 = aucune restriction. Le copy-processor refusera d'ouvrir une position sur un marché dont la fin est prévue dans moins de ce délai."
            onChange={(value) =>
              props.onChange({
                [modeSettingKey(props.mode, 'MinTimeToClose')]: value * 60,
              })
            }
          />
        </section>
      </div>

      <PositionAdjustmentsSection
        prefix={props.mode}
        config={props.config}
        onChange={props.onChange}
      />

      <MarketTagsSection
        mode={props.mode}
        selected={props.config[allowedMarketTagsKey] ?? []}
        onChange={(slugs) =>
          props.onChange({ [allowedMarketTagsKey]: slugs })
        }
      />
    </div>
  );
}

export function EnvSettingsExitTab(props: {
  mode: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  return (
    <div class="settings-tab-panel" role="tabpanel">
      <SettingsTabIntro
        title="Paramètres de sortie"
        description="Stop loss, take profit, trailing et pré-clôture. Les seuils SL/TP sont calculés sur le mouvement de marché (bid vs bid d'entrée), hors frais."
      />

      <div class="settings-panel-grid">
        <ExitSection
          prefix={props.mode}
          config={props.config}
          onChange={props.onChange}
          showTitle={false}
          sectionTitle="SL / TP & trailing"
        />
        <PreCloseSection
          prefix={props.mode}
          config={props.config}
          onChange={props.onChange}
          fullWidth={false}
        />
      </div>
    </div>
  );
}

export function EnvSettingsRiskTab(props: {
  mode: EnvMode;
  config: EnvSettings;
  onChange: (patch: Partial<EnvSettings>) => void;
}) {
  return (
    <div class="settings-tab-panel" role="tabpanel">
      <SettingsTabIntro
        title="Gestion du risque"
        description="Limites d'exposition et comportement en cas de perte journalière excessive. Le kill switch s'active lorsque la perte max est atteinte."
      />

      <section class="settings-section settings-section-full">
        <h3 class="settings-section-title">Limites &amp; kill switch</h3>
        <Show when={props.mode === 'sim'}>
          <div class="settings-panel-grid settings-panel-grid-3">
            <SimInitialCapitalField
              label="Capital initial — Crypto (pUSD)"
              value={props.config.simInitialCapitalCrypto}
              onChange={(simInitialCapitalCrypto) =>
                props.onChange({ simInitialCapitalCrypto })
              }
            />
            <SimInitialCapitalField
              label="Capital initial — Weather (pUSD)"
              value={props.config.simInitialCapitalWeather}
              onChange={(simInitialCapitalWeather) =>
                props.onChange({ simInitialCapitalWeather })
              }
            />
            <SimInitialCapitalField
              label="Capital initial — Copy (pUSD)"
              value={props.config.simInitialCapitalCopy}
              onChange={(simInitialCapitalCopy) =>
                props.onChange({ simInitialCapitalCopy })
              }
            />
          </div>
        </Show>
        <RiskSection
          prefix={props.mode}
          config={props.config}
          onChange={props.onChange}
        />
      </section>
    </div>
  );
}
