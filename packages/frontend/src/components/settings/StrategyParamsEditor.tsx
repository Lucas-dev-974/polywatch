import { For, Show } from 'solid-js';
import type { WeatherStrategyMeta } from '../../api';
import { NumberField, ToggleField, SelectField, NullableNumberField } from './settings-fields';

/** Nullable numeric knobs: stored `0` is coerced to `null` at runtime, so the
 * form uses NullableNumberField to write `null` (disabled) instead of `0`. */
const NULLABLE_PARAM_KEYS = new Set([
  'maxForecastStd',
  'minForecastProbability',
  'maxYesPrice',
  'slPercent',
  'tpPercent',
  'trailingPercent',
  'trailingActivationPercent',
]);

/** Paramètres stockés en millisecondes — affichés et saisis en minutes. */
const DURATION_MS_KEYS = new Set([
  'reentryThrottleMs',
  'reentryThrottleAfterSlMs',
  'entryDepthRetryDelayMs',
]);

function isDurationMsParam(key: string): boolean {
  return DURATION_MS_KEYS.has(key);
}

function msToMin(ms: number): number {
  return ms / 60_000;
}

function minToMs(min: number): number {
  return min * 60_000;
}

function durationLabel(label: string): string {
  return label.replace(/\s*\(ms\)\s*$/i, ' (min)');
}

/** Regroupement logique des paramètres pour un affichage professionnel. */
const PARAM_GROUPS: Array<{ id: string; title: string; keys: string[] }> = [
  {
    id: 'entry',
    title: 'Entrée',
    keys: ['minEdge', 'maxForecastStd', 'minForecastProbability', 'minYesPrice', 'maxYesPrice', 'sizingMode', 'entryPusd', 'fixedShareCount'],
  },
  {
    id: 'exit',
    title: 'Sortie',
    keys: [
      'forecastChangeThreshold',
      'bucketHysteresisPolls',
      'reentryThrottleMs',
      'reentryThrottleAfterSlMs',
      'maxReentriesPerCityDate',
      'cityFollowSwitchMode',
    ],
  },
  {
    id: 'sl-tp',
    title: 'Stop-loss / Take-profit',
    keys: [
      'slEnabled',
      'tpEnabled',
      'trailingEnabled',
      'slPercent',
      'tpPercent',
      'trailingPercent',
      'trailingActivationPercent',
    ],
  },
  {
    id: 'risk',
    title: 'Limites de risque',
    keys: ['maxOpenPositions', 'maxExposurePusd', 'maxDailyLossPusd', 'maxPositionSizePusd'],
  },
  {
    id: 'execution',
    title: 'Exécution',
    keys: [
      'entryDepthRetryMax',
      'entryDepthRetryDelayMs',
      'slCloseMaxRetries',
      'slConfirmationTicks',
      'killSwitchAction',
    ],
  },
  {
    id: 'misc',
    title: 'Divers',
    keys: ['signalScoreSizingEnabled', 'minBidToAskRatio', 'minTimeToClose'],
  },
];

/**
 * Blocs fusionnés du groupe SL/TP/trailing : chaque bloc associe son toggle
 * (interrupteur maître) à son/ses champ(s) pourcentage (seuil). Le toggle sert
 * de titre, le champ percent est rendu en dessous.
 */
const SL_TP_BLOCKS: Array<{
  title: string;
  toggleKey: string;
  percentKeys: string[];
}> = [
  { title: 'Stop-loss', toggleKey: 'slEnabled', percentKeys: ['slPercent'] },
  { title: 'Take-profit', toggleKey: 'tpEnabled', percentKeys: ['tpPercent'] },
  {
    title: 'Trailing',
    toggleKey: 'trailingEnabled',
    percentKeys: ['trailingPercent', 'trailingActivationPercent'],
  },
];

export interface StrategyParamsEditorProps {
  strategy: WeatherStrategyMeta;
  /** Valeurs effectives affichées (pré-remplissage live). */
  values: Record<string, number | boolean | string | null>;
  /** Valeurs surchargées par l'utilisateur (override bag). */
  overrides: Record<string, number | boolean | string | null>;
  /** Clés à exposer (défaut = toutes). Le backtest passe BACKTEST_EFFECTIVE_PARAM_KEYS. */
  visibleKeys?: string[];
  /** Quand fourni, le param `entryPusd` est rendu comme un champ run-level
   * (câblé à cette valeur/onChange) au lieu d'un param du bag de stratégie.
   * Utilisé par le formulaire de backtest où `entryPusd` est un param run-level. */
  entryPusdField?: {
    value: string;
    onChange: (value: string) => void;
  };
  onChange: (key: string, value: number | boolean | string | null) => void;
}

export function StrategyParamsEditor(props: StrategyParamsEditorProps) {
  const visible = (key: string) =>
    !props.visibleKeys || props.visibleKeys.length === 0 || props.visibleKeys.includes(key);

  // Valeur affichée = override si présent, sinon valeur effective (live).
  const valueOf = (key: string): number | boolean | string | null =>
    key in props.overrides ? props.overrides[key] : props.values[key];

  // Mode de sizing effectif (défaut fixed_pusd).
  const sizingMode = () => String(valueOf('sizingMode') ?? 'fixed_pusd');

  // Affichage conditionnel selon le mode de sizing :
  // - entryPusd n'a de sens qu'en fixed_pusd (sizing par montant pUSD).
  // - fixedShareCount n'a de sens qu'en fixed_shares (sizing par parts).
  const sizingVisible = (key: string): boolean => {
    if (key === 'entryPusd') return sizingMode() === 'fixed_pusd';
    if (key === 'fixedShareCount') return sizingMode() === 'fixed_shares';
    return true;
  };

  return (
    <div class="weather-strategy-groups">
      <For each={PARAM_GROUPS}>
        {(group) => {
          const params = () =>
            props.strategy.params
              .filter(
                (p) => group.keys.includes(p.key) && visible(p.key) && sizingVisible(p.key),
              )
              .sort((a, b) => group.keys.indexOf(a.key) - group.keys.indexOf(b.key));
          return (
            <Show when={params().length > 0}>
              <div class="weather-strategy-group">
                <h4 class="weather-strategy-group__title">{group.title}</h4>
                <div class="weather-strategy-group__fields">
                  <Show
                    when={group.id === 'sl-tp'}
                    fallback={
                      <For each={params()}>
                        {(param) => (
                          <Show
                            when={param.key === 'entryPusd' && props.entryPusdField}
                            fallback={
                              <Show
                                when={param.kind === 'boolean'}
                                fallback={
                                  <Show
                                    when={param.kind === 'select'}
                                    fallback={
                                      <Show
                                        when={NULLABLE_PARAM_KEYS.has(param.key)}
                                        fallback={
                                          <NumberField
                                            label={durationLabel(param.label)}
                                            value={
                                              isDurationMsParam(param.key)
                                                ? msToMin(Number(valueOf(param.key) ?? param.default))
                                                : Number(valueOf(param.key) ?? param.default)
                                            }
                                            min={
                                              isDurationMsParam(param.key) && param.min != null
                                                ? msToMin(param.min)
                                                : param.min
                                            }
                                            max={
                                              isDurationMsParam(param.key) && param.max != null
                                                ? msToMin(param.max)
                                                : param.max
                                            }
                                            step={
                                              isDurationMsParam(param.key) && param.step != null
                                                ? msToMin(param.step)
                                                : (param.step ?? 0.01)
                                            }
                                            hint={param.hint}
                                            onChange={(value) =>
                                              props.onChange(
                                                param.key,
                                                isDurationMsParam(param.key) ? minToMs(value) : value,
                                              )
                                            }
                                          />
                                        }
                                      >
                                        <NullableNumberField
                                          label={param.label}
                                          value={valueOf(param.key) as number | null | undefined ?? null}
                                          min={param.min}
                                          max={param.max}
                                          step={param.step ?? 0.01}
                                          hint={param.hint}
                                          onChange={(value) => props.onChange(param.key, value)}
                                        />
                                      </Show>
                                    }
                                  >
                                    <SelectField
                                      label={param.label}
                                      value={String(valueOf(param.key) ?? param.default)}
                                      options={param.options ?? []}
                                      hint={param.hint}
                                      onChange={(value) => props.onChange(param.key, value)}
                                    />
                                  </Show>
                                }
                              >
                                <ToggleField
                                  label={param.label}
                                  checked={Boolean(valueOf(param.key) ?? param.default)}
                                  hint={param.hint}
                                  onChange={(checked) => props.onChange(param.key, checked)}
                                />
                              </Show>
                            }
                          >
                            <div class="form-field">
                              <label>{param.label}</label>
                              <input
                                class="input"
                                type="number"
                                min={param.min}
                                max={param.max}
                                step={param.step ?? 0.01}
                                value={props.entryPusdField!.value}
                                onInput={(e) => props.entryPusdField!.onChange(e.currentTarget.value)}
                              />
                              <Show when={param.hint}>
                                <p class="form-hint">{param.hint}</p>
                              </Show>
                            </div>
                          </Show>
                        )}
                      </For>
                    }
                  >
                    <For each={SL_TP_BLOCKS}>
                      {(block) => {
                        const toggleParam = () =>
                          props.strategy.params.find((p) => p.key === block.toggleKey);
                        const percentParams = () =>
                          block.percentKeys
                            .map((key) => props.strategy.params.find((p) => p.key === key))
                            .filter((p): p is NonNullable<typeof p> => !!p && visible(p.key));
                        return (
                          <Show when={toggleParam() && percentParams().length > 0}>
                            <div class="weather-sl-tp-block">
                              <div class="weather-sl-tp-block__toggle">
                                <label class="toggle-switch">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(valueOf(block.toggleKey) ?? toggleParam()!.default)}
                                    onChange={(e) => props.onChange(block.toggleKey, e.currentTarget.checked)}
                                  />
                                  <span class="weather-sl-tp-block__toggle-inner">
                                    <span class="toggle-track" />
                                    <span class="toggle-label">{block.title}</span>
                                  </span>
                                </label>
                              </div>
                              <div class="weather-sl-tp-block__fields">
                                <For each={percentParams()}>
                                  {(param) => (
                                    <NullableNumberField
                                      label={param.label}
                                      value={valueOf(param.key) as number | null | undefined ?? null}
                                      min={param.min}
                                      max={param.max}
                                      step={param.step ?? 0.01}
                                      hint={param.hint}
                                      onChange={(value) => props.onChange(param.key, value)}
                                    />
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          );
        }}
      </For>
    </div>
  );
}
