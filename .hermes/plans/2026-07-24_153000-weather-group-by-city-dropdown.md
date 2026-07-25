# Weather Algo — Regroupement des marchés par ville (backend)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Le backend retourne les marchés weather découverts regroupés par ville. Pour chaque ville, on récupère tous les marchés "highest temp" et on les retourne sous forme de liste groupée `[{ city, markets[] }, ...]`. Le frontend consomme directement cette structure et l'affiche dans des accordions.

**Architecture:** Le regroupement se fait dans le core (`weather-market-discovery.ts`) via une nouvelle fonction `groupMarketsByCity()` qui parse le `question` de chaque `MarketListItemDto` avec `parseWeatherQuestion()` pour extraire la ville. La route backend `GET /weather-algo-discover` retourne le nouveau format groupé. Le frontend met à jour ses types et composants pour consommer la liste de groupes au lieu d'une liste plate.

**Tech Stack:** TypeScript, Express, SolidJS, Vitest.

---

## Contexte : structure des données actuelles

### Core — `WeatherMarketDiscoveryResult` (`weather-market-discovery.ts:13-18`)
```typescript
export interface WeatherMarketDiscoveryResult {
  temperatureMarkets: MarketListItemDto[];   // markets matchant le parser
  allWeatherMarkets: MarketListItemDto[];     // tous les weather markets matchant la date
}
```

### Backend — `GET /weather-algo-discover` (`weather-algo-discover.ts:8-26`)
```typescript
router.get('/', requireJwt, async (req, res) => {
  const offset = Number(req.query.offset ?? 0);
  const result = await discoverWeatherMarkets({ limit: 100, offset: ... });
  res.json(result);  // { temperatureMarkets: [...], allWeatherMarkets: [...] }
});
```

### Frontend — types (`useWeatherAlgoDashboard.ts:29-43`)
```typescript
export interface DiscoverMarket {
  conditionId: string;
  question: string | null;
  eventSlug: string | null;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
  outcomePrices: Array<{ outcome: string; price: number }>;
  endDate: string | null;
  parsed: boolean;
}

export interface DiscoverResult {
  temperatureMarkets: DiscoverMarket[];
  allWeatherMarkets: DiscoverMarket[];
}
```

### Frontend — consommation (`useWeatherAlgoDashboard.ts:80-91`)
```typescript
const data = await api<DiscoverResult>('/weather-algo-discover?limit=50');
setDiscoverResults(data.allWeatherMarkets ?? []);
```

### Frontend — rendu (`WeatherAlgoDiscoverPanel.tsx:31`)
```tsx
<For each={props.results.slice(0, 40)}>  // liste plate tronquée à 40
```

### Parser — `parseWeatherQuestion` (`question-parser.ts`)
Retourne `ParsedWeatherQuestion | null` avec `city: string` et `metric: 'highest_temp' | 'lowest_temp'`.

### `MarketListItemDto` — champs disponibles (`market-list.ts:10-40`)
```typescript
conditionId, question, slug, eventSlug, icon, endDate, startDate,
volume, volume24hr, liquidityClob, outcomePrices, outcomes,
acceptingOrders, closed, url, tokenIdYes, tokenIdNo, category, tagSlugs,
cryptoSymbol, interval, cryptoCategory, marketType
```

---

## Approche

1. **Core** — Nouvelle fonction `groupMarketsByCity()` + nouveau type `CityMarketGroup`. La fonction `discoverWeatherMarkets()` gagne un champ `byCity` dans son résultat.
2. **Core** — Exporter le nouveau type depuis `index.ts`.
3. **Backend** — La route `GET /weather-algo-discover` retourne le champ `byCity` (array de `CityMarketGroup`).
4. **Frontend** — Mettre à jour les types `DiscoverResult` / `DiscoverMarket` pour inclure le format groupé.
5. **Frontend** — Nouveau composant `WeatherCityGroup` (accordion).
6. **Frontend** — Refactor `WeatherAlgoDiscoverPanel` pour itérer sur les groupes au lieu de la liste plate.
7. **Frontend** — Refactor `WeatherAlgoActiveMarketsPanel` (groupement par `sel.city` côté frontend car déjà disponible).
8. **CSS** — Styles pour l'accordion + cards.

---

## Phase 1 — Core : fonction de regroupement par ville

### Task 1.1: Ajouter `groupMarketsByCity()` et `CityMarketGroup` dans le core

**Objective:** Fonction pure qui prend `MarketListItemDto[]` et retourne un array de groupes `{ city, markets[] }` triés par ville.

**Files:**
- Modify: `packages/core/src/weather/weather-market-discovery.ts` (ajouter à la fin)
- Modify: `packages/core/src/weather/weather-market-discovery.test.ts` (créer si inexistant)

**Step 1: Écrire les tests**

Créer `packages/core/src/weather/weather-market-discovery.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { groupMarketsByCity } from './weather-market-discovery.js';
import type { MarketListItemDto } from '../polymarket/market-list.js';

function makeMarket(overrides: Partial<MarketListItemDto>): MarketListItemDto {
  return {
    conditionId: '0x123',
    question: null,
    slug: null,
    eventSlug: null,
    icon: null,
    endDate: null,
    startDate: null,
    volume: null,
    volume24hr: null,
    liquidityClob: null,
    outcomePrices: [],
    outcomes: [],
    acceptingOrders: null,
    closed: false,
    url: '',
    tokenIdYes: null,
    tokenIdNo: null,
    category: null,
    tagSlugs: [],
    cryptoSymbol: null,
    interval: null,
    cryptoCategory: null,
    marketType: 'standard' as any,
    ...overrides,
  };
}

describe('groupMarketsByCity', () => {
  it('groups markets by city extracted from question', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Hong Kong be 32°C on July 24?' }),
      makeMarket({ conditionId: '3', question: 'Will the highest temperature in Seattle be 70°F on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups).toHaveLength(2);
    const hk = groups.find(g => g.city === 'Hong Kong')!;
    expect(hk.markets).toHaveLength(2);
    const seattle = groups.find(g => g.city === 'Seattle')!;
    expect(seattle.markets).toHaveLength(1);
  });

  it('places unparseable markets under "Autres"', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Some random weather question' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    const autres = groups.find(g => g.city === 'Autres')!;
    expect(autres.markets).toHaveLength(1);
  });

  it('sorts cities alphabetically with "Autres" last', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'random' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Seattle be 70°F on July 24?' }),
      makeMarket({ conditionId: '3', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups.map(g => g.city)).toEqual(['Hong Kong', 'Seattle', 'Autres']);
  });

  it('deduplicates cities case-insensitively', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in hong kong be 32°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups).toHaveLength(1);
    expect(groups[0].city).toBe('Hong Kong');
    expect(groups[0].markets).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(groupMarketsByCity([])).toEqual([]);
  });
});
```

**Step 2: Lancer les tests pour vérifier l'échec**

Run: `npx vitest run packages/core/src/weather/weather-market-discovery.test.ts`
Expected: FAIL — `groupMarketsByCity` n'existe pas

**Step 3: Ajouter `groupMarketsByCity` et `CityMarketGroup`**

Ajouter à la fin de `packages/core/src/weather/weather-market-discovery.ts` :

```typescript
/**
 * A group of weather markets sharing the same city.
 * The `city` field is the display name; `markets` is the flat list of markets for that city.
 */
export interface CityMarketGroup {
  city: string;
  markets: MarketListItemDto[];
}

/**
 * Group a flat list of weather markets by city, extracted via parseWeatherQuestion.
 * Markets whose city cannot be parsed are placed under the fallback label "Autres".
 * Groups are sorted alphabetically by city, with "Autres" always last.
 *
 * @param markets - Flat list of MarketListItemDto (typically from discoverWeatherMarkets)
 * @param metricFilter - Optional: only include markets matching this metric ('highest_temp' | 'lowest_temp'). Default: no filter.
 */
export function groupMarketsByCity(
  markets: MarketListItemDto[],
  metricFilter?: 'highest_temp' | 'lowest_temp',
): CityMarketGroup[] {
  const map = new Map<string, CityMarketGroup>();

  for (const m of markets) {
    const parsed = m.question ? parseWeatherQuestion(m.question) : null;
    if (!parsed) {
      // Unparseable → "Autres"
      const group = map.get('autres') ?? { city: 'Autres', markets: [] };
      group.markets.push(m);
      map.set('autres', group);
      continue;
    }

    // Optional metric filter
    if (metricFilter && parsed.metric !== metricFilter) continue;

    const key = parsed.city.trim().toLowerCase();
    // Preserve the first-seen casing for display
    const existing = map.get(key);
    if (existing) {
      existing.markets.push(m);
    } else {
      map.set(key, { city: parsed.city.trim(), markets: [m] });
    }
  }

  // Sort: named cities alphabetically, "Autres" always last
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.city === 'Autres') return 1;
    if (b.city === 'Autres') return -1;
    return a.city.localeCompare(b.city);
  });

  return groups;
}
```

**Step 4: Lancer les tests pour vérifier le succès**

Run: `npx vitest run packages/core/src/weather/weather-market-discovery.test.ts`
Expected: PASS — 5 tests

**Step 5: Build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.2: Étendre `WeatherMarketDiscoveryResult` avec `byCity` et exporter le nouveau type

**Objective:** Le résultat de `discoverWeatherMarkets` gagne un champ `byCity: CityMarketGroup[]`. Exporter `CityMarketGroup` depuis l'index du core.

**Files:**
- Modify: `packages/core/src/weather/weather-market-discovery.ts:13-18` (interface) et `:79-83` (return)
- Modify: `packages/core/src/index.ts:255` (export)

**Step 1: Étendre l'interface `WeatherMarketDiscoveryResult`**

Remplacer (lignes 13-18) :

```typescript
export interface WeatherMarketDiscoveryResult {
  /** Markets that matched the temperature question parser. */
  temperatureMarkets: MarketListItemDto[];
  /** All weather-tagged markets matching the target date (for the UI). */
  allWeatherMarkets: MarketListItemDto[];
}
```

Par :

```typescript
export interface WeatherMarketDiscoveryResult {
  /** Markets that matched the temperature question parser. */
  temperatureMarkets: MarketListItemDto[];
  /** All weather-tagged markets matching the target date (for the UI). */
  allWeatherMarkets: MarketListItemDto[];
  /** Markets grouped by city, for the dropdown UI. */
  byCity: CityMarketGroup[];
}
```

**Step 2: Ajouter `byCity` au retour de `discoverWeatherMarkets`**

Remplacer (lignes 79-83) :

```typescript
  return {
    temperatureMarkets,
    allWeatherMarkets,
  };
```

Par :

```typescript
  // Group all weather markets by city for the UI dropdown.
  // Filter to highest_temp only (user request: "tous les marchés de highest temp pour une ville donnée").
  const byCity = groupMarketsByCity(allWeatherMarkets, 'highest_temp');

  return {
    temperatureMarkets,
    allWeatherMarkets,
    byCity,
  };
```

**Step 3: Exporter `CityMarketGroup` depuis l'index du core**

Dans `packages/core/src/index.ts`, remplacer la ligne 255 :

```typescript
export { discoverWeatherMarkets, groupMarketsByEvent, WEATHER_TAG_SLUG, type WeatherMarketDiscoveryResult } from './weather/weather-market-discovery.js';
```

Par :

```typescript
export { discoverWeatherMarkets, groupMarketsByEvent, groupMarketsByCity, WEATHER_TAG_SLUG, type WeatherMarketDiscoveryResult, type CityMarketGroup } from './weather/weather-market-discovery.js';
```

**Step 4: Build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

## Phase 2 — Backend : retourner le format groupé

### Task 2.1: La route `GET /weather-algo-discover` retourne `byCity`

**Objective:** La route backend forward le nouveau champ `byCity` tel quel. Aucune logique de regroupement dans la route — c'est le core qui fait le travail.

**Files:**
- Modify: `packages/backend/src/routes/weather-algo-discover.ts`

**Step 1: Aucun changement de code nécessaire**

La route actuelle fait déjà `res.json(result)` où `result` est le retour de `discoverWeatherMarkets()`. Le nouveau champ `byCity` sera automatiquement inclus dans la réponse JSON.

Vérifier que le commentaire existant reste pertinent. Si on veut être explicite, on peut ajouter un commentaire :

Dans `packages/backend/src/routes/weather-algo-discover.ts`, remplacer :

```typescript
      const result = await discoverWeatherMarkets({
        limit: 100,
        offset: Number.isFinite(offset) ? offset : 0,
      });
      res.json(result);
```

Par :

```typescript
      const result = await discoverWeatherMarkets({
        limit: 100,
        offset: Number.isFinite(offset) ? offset : 0,
      });
      // result includes: temperatureMarkets, allWeatherMarkets, byCity
      res.json(result);
```

**Step 2: Build backend**

Run: `npm run build -w @polywatch/backend`
Expected: PASS

---

## Phase 3 — Frontend : types et hook

### Task 3.1: Mettre à jour les types `DiscoverResult` et ajouter `CityMarketGroup`

**Objective:** Le frontend reçoit maintenant `byCity` depuis l'API. Mettre à jour les types et le hook pour stocker les groupes.

**Files:**
- Modify: `packages/frontend/src/hooks/useWeatherAlgoDashboard.ts:29-43` (types) et `:58,80-91` (signal + fetch)

**Step 1: Mettre à jour les types**

Remplacer les interfaces `DiscoverMarket` et `DiscoverResult` (lignes 29-43) :

```typescript
export interface DiscoverMarket {
  conditionId: string;
  question: string | null;
  eventSlug: string | null;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
  outcomePrices: Array<{ outcome: string; price: number }>;
  endDate: string | null;
  parsed: boolean;
}

export interface CityMarketGroup {
  city: string;
  markets: DiscoverMarket[];
}

export interface DiscoverResult {
  temperatureMarkets: DiscoverMarket[];
  allWeatherMarkets: DiscoverMarket[];
  byCity: CityMarketGroup[];
}
```

**Step 2: Changer le signal pour stocker les groupes au lieu de la liste plate**

Remplacer (ligne 58) :

```typescript
  const [discoverResults, setDiscoverResults] = createSignal<DiscoverMarket[]>([]);
```

Par :

```typescript
  const [discoverGroups, setDiscoverGroups] = createSignal<CityMarketGroup[]>([]);
```

**Step 3: Mettre à jour `discoverMarkets()`**

Remplacer (lignes 80-91) :

```typescript
  async function discoverMarkets() {
    setDiscoverLoading(true);
    setDiscoverResults([]);
    try {
      const data = await api<DiscoverResult>('/weather-algo-discover?limit=50');
      setDiscoverResults(data.allWeatherMarkets ?? []);
    } catch (err) {
      console.error('[WeatherAlgo] discoverMarkets failed:', err);
    } finally {
      setDiscoverLoading(false);
    }
  }
```

Par :

```typescript
  async function discoverMarkets() {
    setDiscoverLoading(true);
    setDiscoverGroups([]);
    try {
      const data = await api<DiscoverResult>('/weather-algo-discover?limit=50');
      setDiscoverGroups(data.byCity ?? []);
    } catch (err) {
      console.error('[WeatherAlgo] discoverMarkets failed:', err);
    } finally {
      setDiscoverLoading(false);
    }
  }
```

**Step 4: Mettre à jour le return du hook**

Remplacer (lignes 157-162) :

```typescript
  return {
    selections, status, discoverResults, discoverLoading, autoTrackRules,
    discoverMarkets, addMarket, toggleSelection, removeSelection,
    addAutoTrackRule, removeAutoTrackRule, toggleAutoTrackRule,
    refreshSelections, refreshStatus,
  };
```

Par :

```typescript
  return {
    selections, status, discoverGroups, discoverLoading, autoTrackRules,
    discoverMarkets, addMarket, toggleSelection, removeSelection,
    addAutoTrackRule, removeAutoTrackRule, toggleAutoTrackRule,
    refreshSelections, refreshStatus,
  };
```

**Step 5: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: FAIL — `WeatherAlgoDiscoverPanel` et `WeatherAlgoPage` référencent encore `discoverResults`. On corrige dans les tâches suivantes.

---

## Phase 4 — Frontend : composant accordion

### Task 4.1: Créer le composant `WeatherCityGroup`

**Objective:** Composant accordion réutilisable : header cliquable (ville + badge de compte), body repliable.

**Files:**
- Create: `packages/frontend/src/components/WeatherCityGroup.tsx`

**Step 1: Créer le composant**

```tsx
import { createSignal, For, Show } from 'solid-js';

export interface WeatherCityGroupProps<T> {
  city: string;
  markets: T[];
  /** Render each market item inside the accordion body. */
  renderItem: (item: T) => any;
  /** Initial expanded state. Default: collapsed. */
  defaultExpanded?: boolean;
}

export function WeatherCityGroup<T>(props: WeatherCityGroupProps<T>) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  return (
    <div class="weather-city-group" classList={{ 'weather-city-group--expanded': expanded() }}>
      <button
        type="button"
        class="weather-city-group__header"
        onClick={() => setExpanded(!expanded())}
        aria-expanded={expanded()}
      >
        <span class="weather-city-group__chevron">{expanded() ? '▾' : '▸'}</span>
        <span class="weather-city-group__city">{props.city}</span>
        <span class="weather-city-group__count">{props.markets.length}</span>
      </button>
      <Show when={expanded()}>
        <div class="weather-city-group__body">
          <For each={props.markets}>
            {(item) => props.renderItem(item)}
          </For>
        </div>
      </Show>
    </div>
  );
}
```

**Step 2: Build**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS (le composant est nouveau, pas encore importé)

---

## Phase 5 — Frontend : refactor `WeatherAlgoDiscoverPanel`

### Task 5.1: Remplacer la liste plate par les groupes par ville

**Objective:** Le panel reçoit maintenant `CityMarketGroup[]` au lieu de `DiscoverMarket[]`. Itérer sur les groupes avec `WeatherCityGroup`.

**Files:**
- Modify: `packages/frontend/src/components/WeatherAlgoDiscoverPanel.tsx` (remplacer tout le contenu)
- Modify: `packages/frontend/src/components/WeatherAlgoPage.tsx` (mettre à jour les props)

**Step 1: Réécrire `WeatherAlgoDiscoverPanel.tsx`**

```tsx
import { For, Show } from 'solid-js';
import { parseWeatherQuestion } from '@polywatch/core/weather/question-parser';
import type { DiscoverMarket, CityMarketGroup } from '../hooks/useWeatherAlgoDashboard';
import { WeatherCityGroup } from './WeatherCityGroup';

export interface WeatherAlgoDiscoverPanelProps {
  groups: CityMarketGroup[];
  loading: boolean;
  onRefresh: () => void;
  onAdd: (conditionId: string, question: string, eventSlug: string | null) => void;
}

export function WeatherAlgoDiscoverPanel(props: WeatherAlgoDiscoverPanelProps) {
  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Découverte marchés Polymarket</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => props.onRefresh()}
          disabled={props.loading}
        >
          {props.loading ? '...' : 'Rafraîchir'}
        </button>
      </div>

      <Show when={props.groups.length === 0 && !props.loading}>
        <div class="algo-empty">Aucun marché météo trouvé sur Polymarket.</div>
      </Show>

      <For each={props.groups}>
        {(group) => (
          <WeatherCityGroup
            city={group.city}
            markets={group.markets}
            renderItem={(market: DiscoverMarket) => {
              const parsed = market.question ? parseWeatherQuestion(market.question) : null;
              return (
                <div class="weather-discover-card">
                  <div class="weather-discover-card__question">{market.question}</div>
                  <div class="weather-discover-card__prices">
                    <For each={market.outcomePrices}>
                      {(p) => (
                        <span class="weather-discover-card__price">
                          {p.outcome}: {(p.price * 100).toFixed(0)}%
                        </span>
                      )}
                    </For>
                  </div>
                  <Show when={parsed}>
                    <button
                      class="btn btn-sm btn-primary"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre
                    </button>
                  </Show>
                  <Show when={!parsed}>
                    <button
                      class="btn btn-sm btn-ghost"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre manuellement
                    </button>
                  </Show>
                </div>
              );
            }}
          />
        )}
      </For>
    </section>
  );
}
```

**Step 2: Mettre à jour `WeatherAlgoPage.tsx`**

Dans `packages/frontend/src/components/WeatherAlgoPage.tsx`, remplacer :

```tsx
          <WeatherAlgoDiscoverPanel
            results={dashboard.discoverResults()}
            loading={dashboard.discoverLoading()}
            onRefresh={dashboard.discoverMarkets}
            onAdd={dashboard.addMarket}
          />
```

Par :

```tsx
          <WeatherAlgoDiscoverPanel
            groups={dashboard.discoverGroups()}
            loading={dashboard.discoverLoading()}
            onRefresh={dashboard.discoverMarkets}
            onAdd={dashboard.addMarket}
          />
```

**Step 3: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 6 — Frontend : refactor `WeatherAlgoActiveMarketsPanel`

### Task 6.1: Grouper les marchés suivis par ville (côté frontend)

**Objective:** Les marchés suivis ont déjà `sel.city` — on groupe côté frontend car ces données viennent de la DB et sont déjà structurées.

**Files:**
- Modify: `packages/frontend/src/components/WeatherAlgoActiveMarketsPanel.tsx` (remplacer tout le contenu)
- Create: `packages/frontend/src/lib/weather-grouping.ts` (utilitaire de regroupement frontend pour les selections)

**Step 1: Créer l'utilitaire de regroupement frontend**

Créer `packages/frontend/src/lib/weather-grouping.ts` :

```typescript
export interface CityGroup<T> {
  city: string;
  key: string;
  items: T[];
}

/**
 * Group items by city using a string accessor.
 * Items with null/empty city are placed under "Autres".
 * Sorted alphabetically, "Autres" last.
 */
export function groupByCity<T>(
  items: T[],
  getCity: (item: T) => string | null,
): CityGroup<T>[] {
  const map = new Map<string, CityGroup<T>>();

  for (const item of items) {
    const rawCity = getCity(item);
    const key = rawCity ? rawCity.trim().toLowerCase() : 'autres';
    const displayCity = rawCity?.trim() || 'Autres';

    let group = map.get(key);
    if (!group) {
      group = { city: displayCity, key, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.key === 'autres') return 1;
    if (b.key === 'autres') return -1;
    return a.city.localeCompare(b.city);
  });

  return groups;
}
```

**Step 2: Réécrire `WeatherAlgoActiveMarketsPanel.tsx`**

```tsx
import { For, Show } from 'solid-js';
import type { WeatherSelection } from '../hooks/useWeatherAlgoDashboard';
import { groupByCity } from '../lib/weather-grouping';
import { WeatherCityGroup } from './WeatherCityGroup';

export interface WeatherAlgoActiveMarketsPanelProps {
  selections: WeatherSelection[];
  onToggle: (conditionId: string, enabled: boolean) => void;
  onRemove: (conditionId: string) => void;
}

export function WeatherAlgoActiveMarketsPanel(props: WeatherAlgoActiveMarketsPanelProps) {
  const groups = () => groupByCity(props.selections, (s) => s.city);

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Marchés suivis ({props.selections.length})</h2>
      </div>

      <Show when={props.selections.length === 0}>
        <div class="algo-empty">Aucun marché suivi. Découvrez et ajoutez des marchés ci-dessous.</div>
      </Show>

      <For each={groups()}>
        {(group) => (
          <WeatherCityGroup
            city={group.city}
            markets={group.items}
            defaultExpanded={true}
            renderItem={(sel: WeatherSelection) => (
              <div class="weather-selection-card" classList={{ 'weather-selection-card--disabled': !sel.enabled }}>
                <div class="weather-selection-card__header">
                  <Show when={sel.targetValue != null}>
                    <span class="weather-selection-card__temp">{sel.targetValue}°C</span>
                  </Show>
                  <span class="weather-selection-card__metric">{sel.metric ?? ''}</span>
                </div>
                <div class="weather-selection-card__question">{sel.question}</div>
                <div class="weather-selection-card__actions">
                  <button class="btn btn-sm btn-ghost" onClick={() => props.onToggle(sel.conditionId, !sel.enabled)}>
                    {sel.enabled ? 'Désactiver' : 'Activer'}
                  </button>
                  <button class="btn btn-sm btn-ghost" onClick={() => props.onRemove(sel.conditionId)}>
                    Supprimer
                  </button>
                </div>
              </div>
            )}
          />
        )}
      </For>
    </section>
  );
}
```

**Step 3: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 7 — CSS

### Task 7.1: Ajouter les styles pour l'accordion et les weather cards

**Objective:** Styles pour `.weather-city-group`, `.weather-discover-card`, `.weather-selection-card` qui n'existent pas encore dans `styles.css`.

**Files:**
- Modify: `packages/frontend/src/styles.css` (append à la fin)

**Step 1: Ajouter les styles à la fin du fichier**

```css
/* === Weather Algo — City Group Accordion === */
.weather-city-group {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: .5rem;
}

.weather-city-group__header {
  display: flex;
  align-items: center;
  gap: .5rem;
  width: 100%;
  padding: .625rem .75rem;
  border: none;
  background: var(--bg-elevated);
  color: var(--text);
  font-family: var(--font);
  font-size: .8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s;
  text-align: left;
}

.weather-city-group__header:hover {
  background: var(--surface-hover);
}

.weather-city-group__chevron {
  font-size: .75rem;
  color: var(--text-muted);
  width: 1rem;
  text-align: center;
  flex-shrink: 0;
}

.weather-city-group__city {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weather-city-group__count {
  font-size: .6875rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface);
  padding: .125rem .5rem;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.weather-city-group__body {
  display: flex;
  flex-direction: column;
  gap: .375rem;
  padding: .5rem .625rem;
  border-top: 1px solid var(--border-subtle);
}

/* === Weather Discover Card === */
.weather-discover-card {
  display: flex;
  flex-direction: column;
  gap: .375rem;
  padding: .625rem .75rem;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.weather-discover-card__question {
  font-size: .8125rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.weather-discover-card__prices {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
}

.weather-discover-card__price {
  font-size: .75rem;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  padding: .125rem .375rem;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
}

/* === Weather Selection Card === */
.weather-selection-card {
  display: flex;
  flex-direction: column;
  gap: .375rem;
  padding: .625rem .75rem;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  transition: opacity .15s;
}

.weather-selection-card--disabled {
  opacity: .5;
}

.weather-selection-card__header {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.weather-selection-card__temp {
  font-size: .875rem;
  font-weight: 700;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.weather-selection-card__metric {
  font-size: .75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .03em;
}

.weather-selection-card__question {
  font-size: .75rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.weather-selection-card__actions {
  display: flex;
  gap: .375rem;
}
```

**Step 2: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 8 — Validation

### Task 8.1: Build complet, tests, et vérification

**Step 1: Lancer tous les tests core**

Run: `npx vitest run packages/core/src/weather/`
Expected: PASS — tous les tests weather (parser + discovery)

**Step 2: Build monorepo complet**

Run: `npm run build`
Expected: PASS

**Step 3: Lancer le frontend en dev**

Run: `npm run dev -w @polywatch/frontend`
Expected: Le serveur dev démarre sans erreur.

**Step 4: Naviguer vers la page Weather Algo**

Vérifier visuellement :
- [ ] L'API `GET /weather-algo-discover` retourne `byCity` dans la réponse
- [ ] Les marchés découverts sont groupés par ville dans des accordions
- [ ] Cliquer sur un header de ville replie/déplie la liste
- [ ] Le badge de compte affiche le nombre de marchés par ville
- [ ] Seuls les marchés `highest_temp` sont inclus (le filtre `metricFilter: 'highest_temp'`)
- [ ] Les marchés non-parsables sont absents (filtrés par le metric filter) — ou sous "Autres" si on retire le filtre
- [ ] Les marchés suivis sont aussi groupés par ville (dépliés par défaut)
- [ ] Aucune erreur console

---

## Résumé des changements

| Couche | Fichier | Changement |
|--------|--------|------------|
| Core | `weather-market-discovery.ts` | + `CityMarketGroup` interface, + `groupMarketsByCity()` function, + `byCity` field in result |
| Core | `weather-market-discovery.test.ts` | New: 5 tests for `groupMarketsByCity` |
| Core | `index.ts` | Export `groupMarketsByCity`, `CityMarketGroup` |
| Backend | `weather-algo-discover.ts` | Comment-only (result already forwarded) |
| Frontend | `useWeatherAlgoDashboard.ts` | `discoverResults` → `discoverGroups`, types `CityMarketGroup` + `DiscoverResult.byCity` |
| Frontend | `WeatherCityGroup.tsx` | New: accordion component |
| Frontend | `WeatherAlgoDiscoverPanel.tsx` | Liste plate → itération sur `CityMarketGroup[]` |
| Frontend | `WeatherAlgoPage.tsx` | Props: `results` → `groups` |
| Frontend | `WeatherAlgoActiveMarketsPanel.tsx` | Groupe par `sel.city` via `groupByCity` |
| Frontend | `lib/weather-grouping.ts` | New: `groupByCity` utilitaire frontend |
| Frontend | `styles.css` | + styles accordion + cards |

---

## Risques et edge cases

1. **Marchés `lowest_temp` exclus** — Le filtre `metricFilter: 'highest_temp'` dans `groupMarketsByCity` exclut les marchés `lowest_temp`. Si on veut les inclure plus tard, il suffit de retirer le paramètre ou d'ajouter un toggle dans l'API.

2. **Marchés sans question parsable** — Avec le filtre `highest_temp`, ils sont automatiquement exclus car `parseWeatherQuestion` retourne `null`. Sans le filtre, ils iraient sous "Autres".

3. **Noms de ville variantes** — "Hong Kong" vs "hong kong" → normalisation par `trim().toLowerCase()` dans `groupMarketsByCity`. La clé de dédup est insensible à la casse, le display garde la première casse rencontrée.

4. **Performance** — `groupMarketsByCity` est appelé une fois dans `discoverWeatherMarkets()` sur max ~500 marchés (5 pages × 100). Négligeable.

5. **Rétrocompatibilité API** — Les champs `temperatureMarkets` et `allWeatherMarkets` restent dans la réponse. Le nouveau champ `byCity` est additif. Les consumers existants ne cassent pas.

6. **`parseWeatherQuestion` import dans le core** — Déjà importé dans `weather-market-discovery.ts:5`. Aucun nouvel import nécessaire.