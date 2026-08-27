import { For } from 'solid-js';

import { marketTagLabel, type GammaTag } from '../../lib/market-tags';

interface Props {
  tags: () => GammaTag[];
  activeSlug: () => string | null;
  onSelect: (slug: string | null) => void;
}

export function MarketsTagBar(props: Props) {
  return (
    <div class="markets-tag-bar" role="tablist" aria-label="Catégories de marchés">
      <button
        type="button"
        role="tab"
        class={`markets-tag-chip${props.activeSlug() === null ? ' active' : ''}`}
        aria-selected={props.activeSlug() === null}
        onClick={() => props.onSelect(null)}
      >
        Tous
      </button>
      <For each={props.tags()}>
        {(tag) => (
          <button
            type="button"
            role="tab"
            class={`markets-tag-chip${props.activeSlug() === tag.slug ? ' active' : ''}`}
            aria-selected={props.activeSlug() === tag.slug}
            onClick={() => props.onSelect(tag.slug)}
          >
            {marketTagLabel(tag)}
          </button>
        )}
      </For>
    </div>
  );
}
