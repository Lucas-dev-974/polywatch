import { For, Show } from 'solid-js';
import { fmtUsd } from '../format';
import type { TooltipInfo } from './types';

/** Tooltip affichant la légende couleur/bucket/prix + les positions de la row survolée. */
export function RidgeTooltip(props: { info: TooltipInfo | null }) {
  return (
    <Show when={props.info}>
      {(info) => (
        <div class="backtest-ridge-tooltip">
          <div class="backtest-ridge-tooltip-title">{info().city} · {info().date}</div>
          <Show when={info().forecastMean != null}>
            <div class="backtest-ridge-tooltip-forecast">
              Prévision {info().forecastMean!.toFixed(1)}
              {info().forecastStdDev != null ? ` ± ${info().forecastStdDev!.toFixed(1)}` : ''}
            </div>
          </Show>
          <Show when={info().buckets.length > 0}>
            <dl class="backtest-ridge-tooltip-grid">
              <dt>Date/heure</dt>
              <dd>{info().cursorLabel}</dd>
            </dl>
            <div class="backtest-ridge-legend">
              <For each={info().buckets}>
                {(b) => (
                  <div class="backtest-ridge-legend-row">
                    <span class="backtest-ridge-legend-swatch" style={{ '--ridge-color': b.color }} />
                    <span class="backtest-ridge-legend-label">{b.label}</span>
                    <strong class="backtest-ridge-legend-price">{b.price != null ? b.price.toFixed(3) : '—'}</strong>
                  </div>
                )}
              </For>
            </div>
            <Show when={info().hasPositions}>
              <div class="backtest-ridge-tooltip-pos">
                <div class="backtest-ridge-tooltip-title">Positions</div>
                <For each={info().positionBuckets}>
                  {(b) => (
                    <div class="backtest-ridge-tooltip-pos-row">
                      <span class="backtest-ridge-legend-swatch" style={{ '--ridge-color': b.color }} />
                      <dl class="backtest-ridge-tooltip-grid">
                        <dt>Position</dt>
                        <dd>#{b.position!.id}</dd>
                        <dt>Côté</dt>
                        <dd>{b.position!.side}</dd>
                        <dt>Qté</dt>
                        <dd>{b.position!.qty}</dd>
                        <dt>Entrée</dt>
                        <dd>{fmtUsd(b.position!.entryPrice)}</dd>
                        <dt>Sortie</dt>
                        <dd>{b.position!.exitPrice != null ? fmtUsd(b.position!.exitPrice) : '—'}</dd>
                        <dt>P&L</dt>
                        <dd class={b.position!.pnl != null && b.position!.pnl >= 0 ? 'backtest-ridge-tooltip-pnl-pos' : 'backtest-ridge-tooltip-pnl-neg'}>
                          {b.position!.pnl != null ? fmtUsd(b.position!.pnl) : '—'}
                        </dd>
                      </dl>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      )}
    </Show>
  );
}
