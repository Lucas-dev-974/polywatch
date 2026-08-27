import { For, Show } from 'solid-js';
import { removeAlgoMarket } from '../stores/algoMarketsStore';
import type { AlgoMarketPrice } from './algo/AlgoMarketCard';
import { Icon } from './Icon';

export interface CryptoAlgoInactiveMarketsPanelProps {
  markets: AlgoMarketPrice[];
}

export function CryptoAlgoInactiveMarketsPanel(props: CryptoAlgoInactiveMarketsPanelProps) {
  return (
    <Show when={props.markets.length > 0}>
      <section class="algo-panel algo-panel-full">
        <div class="algo-panel-header">
          <h2 class="algo-panel-title">
            <Icon name="activity" />
            Marchés inactifs
          </h2>
          <span class="algo-panel-count">{props.markets.length} marchés</span>
        </div>
        <div class="algo-inactive-markets">
          <For each={props.markets}>
            {(mp) => (
              <div
                class={`algo-inactive-market-card ${mp.resolved ? 'resolved' : mp.closed ? 'closed' : 'disabled'}`}
              >
                <div class="algo-inactive-market-info">
                  <span class="algo-inactive-market-symbol">{mp.cryptoSymbol ?? '—'}</span>
                  <span class="algo-inactive-market-interval">{mp.interval ?? '—'}</span>
                </div>
                <Show when={mp.resolved}>
                  <span class="algo-inactive-badge resolved">Résolu</span>
                </Show>
                <Show when={mp.closed && !mp.resolved}>
                  <span class="algo-inactive-badge closed">Fermé</span>
                </Show>
                <Show when={!mp.enabled && !mp.resolved && !mp.closed}>
                  <span class="algo-inactive-badge disabled">Désactivé</span>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm btn-danger"
                  onClick={() => void removeAlgoMarket(mp.conditionId)}
                  title="Supprimer"
                >
                  <Icon name="trash" />
                </button>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
