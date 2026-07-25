import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  fetchMarketTags,
  marketTagLabel,
  searchMarketTags,
  type GammaTag,
} from '../lib/market-tags';
import type { EnvMode } from './env-settings-types';

function TagChip(props: {
  label: string;
  chipClass: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label class={`${props.chipClass} ${props.selected ? 'active' : ''}`}>
      <input
        type="checkbox"
        checked={props.selected}
        onChange={props.onToggle}
      />
      {props.label}
    </label>
  );
}

export function MarketTagsSection(props: {
  mode: EnvMode;
  selected: string[];
  onChange: (slugs: string[]) => void;
}) {
  const [navTags, setNavTags] = createSignal<GammaTag[]>([]);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<GammaTag[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const chipClass = () =>
    props.mode === 'sim' ? 'chip chip-sim' : 'chip chip-real';

  function isSelected(slug: string): boolean {
    return props.selected.includes(slug);
  }

  function toggleSlug(slug: string) {
    const current = props.selected;
    props.onChange(
      current.includes(slug)
        ? current.filter((s) => s !== slug)
        : [...current, slug],
    );
  }

  async function loadNav() {
    try {
      const data = await fetchMarketTags();
      setNavTags(data.nav);
      setLoadError(null);
    } catch {
      setLoadError('Impossible de charger les types de marché.');
    }
  }

  createEffect(() => {
    void loadNav();
  });

  createEffect(() => {
    if (!searchOpen()) return;

    const query = searchQuery().trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      void searchMarketTags(query)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);

    onCleanup(() => clearTimeout(timer));
  });

  const extraSelected = () => {
    const navSlugs = new Set(navTags().map((t) => t.slug));
    return props.selected.filter((slug) => !navSlugs.has(slug));
  };

  return (
    <section class="settings-section market-tags-section">
      <h3 class="settings-section-title">Types de marché autorisés</h3>
      <p class="form-hint">
        Aucune sélection = tous les marchés. Les sorties ne sont pas filtrées.
      </p>

      <Show when={loadError()}>
        <p class="form-hint" style="color: var(--danger);">
          {loadError()}
        </p>
      </Show>

      <div class="chip-group">
        <For each={navTags()}>
          {(tag) => (
            <TagChip
              label={marketTagLabel(tag)}
              chipClass={chipClass()}
              selected={isSelected(tag.slug)}
              onToggle={() => toggleSlug(tag.slug)}
            />
          )}
        </For>
      </div>

      <Show when={extraSelected().length > 0}>
        <div class="market-tags-extra">
          <span class="form-hint">Tags additionnels :</span>
          <div class="chip-group">
            <For each={extraSelected()}>
              {(slug) => (
                <button
                  type="button"
                  class="badge neutral badge-xs"
                  onClick={() => toggleSlug(slug)}
                  title="Retirer"
                >
                  {slug} ×
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show
        when={searchOpen()}
        fallback={
          <button
            type="button"
            class="btn btn-ghost btn-sm market-tags-search-toggle"
            onClick={() => setSearchOpen(true)}
          >
            Rechercher d'autres tags
          </button>
        }
      >
        <div class="form-field market-tags-search">
          <label>Rechercher un tag Gamma</label>
          <input
            class="input"
            type="search"
            placeholder="ex. nba, bitcoin…"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <Show when={searching()}>
            <p class="form-hint">Recherche…</p>
          </Show>
          <Show when={!searching() && searchQuery().trim().length >= 2}>
            <div class="chip-group">
              <For each={searchResults()}>
                {(tag) => (
                  <TagChip
                    label={tag.label}
                    chipClass={chipClass()}
                    selected={isSelected(tag.slug)}
                    onToggle={() => toggleSlug(tag.slug)}
                  />
                )}
              </For>
            </div>
            <Show when={searchResults().length === 0}>
              <p class="form-hint">Aucun tag trouvé.</p>
            </Show>
          </Show>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
          >
            Fermer la recherche
          </button>
        </div>
      </Show>
    </section>
  );
}
