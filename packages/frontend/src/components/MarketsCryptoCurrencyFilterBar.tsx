import { For, Show, createMemo } from 'solid-js';

import type { MarketListItemDto } from '@polywatch/core/market-list';

interface Props {
  items: () => MarketListItemDto[];
  activeSymbol: () => string | null;
  onSelectSymbol: (symbol: string | null) => void;
}

export function MarketsCryptoCurrencyFilterBar(props: Props) {
  const counts = createMemo(() => {
    const map = new Map<string, number>();
    for (const item of props.items()) {
      const symbol = item.cryptoSymbol;
      if (!symbol) continue;
      map.set(symbol, (map.get(symbol) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  return (
    <Show when={counts().length > 0}>
      <div class="markets-crypto-currency-filter-bar">
        <div class="markets-crypto-currency-filter-group">
          <button
            type="button"
            class={`markets-crypto-currency-chip${props.activeSymbol() === null ? ' active' : ''}`}
            onClick={() => props.onSelectSymbol(null)}
          >
            Toutes
          </button>
          <For each={counts()}>
            {([symbol, count]) => (
              <button
                type="button"
                class={`markets-crypto-currency-chip${props.activeSymbol() === symbol ? ' active' : ''}`}
                onClick={() =>
                  props.onSelectSymbol(
                    props.activeSymbol() === symbol ? null : symbol,
                  )
                }
              >
                <span class="markets-crypto-currency-name">{symbol}</span>
                <span class="markets-crypto-currency-count">{count}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
