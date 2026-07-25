import { For } from 'solid-js';

import { CRYPTO_CATEGORY_OPTIONS } from '../lib/markets-list';

interface Props {
  activeCategory: () => string | null;
  onSelectCategory: (category: string | null) => void;
}

export function MarketsCryptoFilterBar(props: Props) {
  return (
    <div class="markets-crypto-filter-bar">
      <div class="markets-crypto-filter-group">
        <span class="markets-crypto-filter-label">Type de marché</span>
        <button
          type="button"
          class={`markets-tag-chip${props.activeCategory() === null ? ' active' : ''}`}
          onClick={() => props.onSelectCategory(null)}
        >
          Tous
        </button>
        <For each={CRYPTO_CATEGORY_OPTIONS}>
          {(category) => (
            <button
              type="button"
              class={`markets-tag-chip${props.activeCategory() === category.value ? ' active' : ''}`}
              onClick={() => props.onSelectCategory(category.value)}
            >
              {category.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
