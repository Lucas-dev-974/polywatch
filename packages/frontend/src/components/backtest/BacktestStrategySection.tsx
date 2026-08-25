import { For, Show } from 'solid-js';
import type { BacktestRunStrategyDto } from '../../api';
import { CollapsibleSection } from '../CollapsibleSection';

interface BacktestStrategySectionProps {
  strategy: BacktestRunStrategyDto | null | undefined;
}

export function BacktestStrategySection(props: BacktestStrategySectionProps) {
  return (
    <Show when={props.strategy}>
      {(s) => (
        <CollapsibleSection
          title={`Stratégie — ${s().label}`}
          defaultCollapsed={true}
          persistKey="backtest-detail-metrics-strategy"
          class="backtest-metrics-strategy"
        >
          <div class="backtest-strategy">
            <p class="backtest-strategy-id">
              <code>{s().id}</code>
            </p>
            <Show when={s().description}>
              <p class="form-hint backtest-strategy-desc">{s().description}</p>
            </Show>
            <Show
              when={s().params.length > 0}
              fallback={
                <p class="form-hint">
                  Paramètres de stratégie indisponibles pour cette run (snapshot absent).
                </p>
              }
            >
              <dl class="backtest-strategy-params">
                <For each={s().params}>
                  {(p) => (
                    <div class="backtest-strategy-param" title={p.hint}>
                      <dt>{p.label}</dt>
                      <dd>{p.display}</dd>
                    </div>
                  )}
                </For>
              </dl>
            </Show>
          </div>
        </CollapsibleSection>
      )}
    </Show>
  );
}
