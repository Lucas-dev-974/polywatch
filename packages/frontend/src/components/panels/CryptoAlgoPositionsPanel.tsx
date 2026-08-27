import { For, Show } from 'solid-js';
import { formatShortDateTime } from '../../lib/date';
import {
  formatPnlAmount,
  formatPnlPercent,
  investedAmount,
  pnlClass,
  pnlPercent,
} from '../../lib/position';
import type { useCryptoAlgoPositions } from '../../hooks/useCryptoAlgoPositions';
import { Icon } from '../Icon';
import { PositionMarketChartTrigger } from '../PositionMarketChartTrigger';

type PositionsState = ReturnType<typeof useCryptoAlgoPositions>;

export interface CryptoAlgoPositionsPanelProps {
  positions: PositionsState;
}

export function CryptoAlgoPositionsPanel(props: CryptoAlgoPositionsPanelProps) {
  const p = () => props.positions;

  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="briefcase" />
          Positions de l'algo
        </h2>
        <div class="algo-panel-header-right">
          <div class="algo-pos-tabs">
            <button
              type="button"
              class={`algo-pos-tab ${p().posTab() === 'open' ? 'active' : ''}`}
              onClick={() => p().setPosTab('open')}
            >
              Ouvertes ({p().openPositions().length})
            </button>
            <button
              type="button"
              class={`algo-pos-tab ${p().posTab() === 'history' ? 'active' : ''}`}
              onClick={() => p().setPosTab('history')}
            >
              Historique ({p().closedPositions().length})
            </button>
          </div>
          <div class="algo-pos-mode-tabs">
            <button
              type="button"
              class={`algo-pos-mode-tab ${p().posModeFilter() === 'all' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('all')}
            >
              Tous
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${p().posModeFilter() === 'sim' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('sim')}
            >
              Sim
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${p().posModeFilter() === 'real' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('real')}
            >
              Réel
            </button>
          </div>
          <span class="algo-panel-count">{p().positions().length} total</span>
        </div>
      </div>

      <Show when={!p().loadingPositions()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={p().posTab() === 'open'}>
          <Show
            when={p().openPositions().length > 0}
            fallback={
              <div class="algo-empty">
                {p().posModeFilter() === 'all'
                  ? 'Aucune position ouverte.'
                  : `Aucune position ouverte en mode ${p().posModeFilter() === 'sim' ? 'Sim' : 'Réel'}.`}
              </div>
            }
          >
            <div class="algo-table-wrap">
              <table class="algo-table">
                <thead>
                  <tr>
                    <th>Marché</th>
                    <th>Outcome</th>
                    <th>Qté</th>
                    <th>Prix entrée</th>
                    <th>PnL</th>
                    <th>Mode</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={p().openPositions()}>
                    {(pos) => (
                      <tr>
                        <td class="cell-truncate" title={pos.marketQuestion ?? pos.conditionId}>
                          {pos.marketQuestion ?? pos.conditionId.slice(0, 12) + '…'}
                        </td>
                        <td>
                          <span class="algo-badge">{pos.outcome}</span>
                        </td>
                        <td class="text-mono">{pos.quantity.toFixed(2)}</td>
                        <td class="text-mono">{pos.entryPrice.toFixed(4)}</td>
                        <td class={`text-mono ${pnlClass(pos.unrealizedPnl)}`}>
                          {formatPnlAmount(pos.unrealizedPnl, true)}
                        </td>
                        <td>
                          <span class={`algo-mode-badge ${pos.mode}`}>
                            {pos.mode === 'real' ? 'Réel' : 'Sim'}
                          </span>
                        </td>
                        <td>
                          <PositionMarketChartTrigger
                            pos={pos}
                            buttonClass="btn btn-ghost btn-sm algo-surveillance-chart-btn"
                          />
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>

        <Show when={p().posTab() === 'history'}>
          <Show
            when={p().closedPositions().length > 0}
            fallback={
              <div class="algo-empty">
                {p().posModeFilter() === 'all'
                  ? 'Aucune position clôturée.'
                  : `Aucune position clôturée en mode ${p().posModeFilter() === 'sim' ? 'Sim' : 'Réel'}.`}
              </div>
            }
          >
            <div class="algo-table-wrap">
              <table class="algo-table">
                <thead>
                  <tr>
                    <th>Marché</th>
                    <th>Outcome</th>
                    <th>Qté</th>
                    <th>Prix entrée</th>
                    <th>PnL réalisé</th>
                    <th>Mode</th>
                    <th>Clôturé le</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={p().closedPositions()}>
                    {(pos) => {
                      const invested = investedAmount(pos);
                      const pct = pnlPercent(pos.realizedPnl, invested);
                      return (
                        <tr>
                          <td class="cell-truncate" title={pos.marketQuestion ?? pos.conditionId}>
                            {pos.marketQuestion ?? pos.conditionId.slice(0, 12) + '…'}
                          </td>
                          <td>
                            <span class="algo-badge">{pos.outcome}</span>
                          </td>
                          <td class="text-mono">{pos.quantity.toFixed(2)}</td>
                          <td class="text-mono">{pos.entryPrice.toFixed(4)}</td>
                          <td class={`text-mono ${pnlClass(pos.realizedPnl)}`}>
                            {formatPnlAmount(pos.realizedPnl, true)}
                            <Show when={pct != null}>
                              <span class="algo-pnl-pct"> ({formatPnlPercent(pct)})</span>
                            </Show>
                          </td>
                          <td>
                            <span class={`algo-mode-badge ${pos.mode}`}>
                              {pos.mode === 'real' ? 'Réel' : 'Sim'}
                            </span>
                          </td>
                          <td class="text-mono text-sm">
                            {pos.closedAt ? formatShortDateTime(pos.closedAt) : '—'}
                          </td>
                          <td>
                            <PositionMarketChartTrigger
                              pos={pos}
                              buttonClass="btn btn-ghost btn-sm algo-surveillance-chart-btn"
                            />
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
