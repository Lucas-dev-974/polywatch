# Weather Algo — Température de prédiction dans les headers de dropdown

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Dans chaque header de dropdown de la page Weather Algo, afficher la température de prédiction (forecast mean) de la ville pour la date cible (ex: "Hong Kong — 31.5°C"). L'enrichissement se fait côté backend, la route `/api/weather-algo-discover` retourne les groupes par ville avec leur température associée.

**Architecture:** La fonction `discoverWeatherMarkets()` (core) garde sa responsabilité de découverte pure. Une nouvelle fonction d'enrichissement `enrichCityGroupsWithForecast()` est appelée par la route backend après la découverte. Elle utilise le cache DB (`WeatherForecastService`) puis, en cas de cache miss, appelle Open-Meteo via `fetchWeatherForecast()`. Les appels par ville sont parallélisés. Le résultat est un nouveau type `ForecastEnrichedCityGroup` contenant `forecastMean`, `forecastStdDev`, `forecastStatus`. Le frontend met à jour `CityMarketGroup` pour afficher cette donnée dans `WeatherCityGroup`.

**Tech Stack:** TypeScript, Express, TypeORM, Open-Meteo, SolidJS.

---

## Contexte : ce qui existe déjà

### Route forecast existante (`weather-algo-forecasts.ts:10-82`)
```typescript
router.get('/:city/:date', requireJwt, async (req, res) => {
  const metric = String(req.query.metric ?? 'highest_temp');
  const cached = await forecastService.getCached(city, forecastDate, metric);
  if (cached?.isFresh) return res.json(cached);
  const fresh = await fetchWeatherForecast(city, forecastDate, metric);
  // save + return
});
```

### Service de cache existant (`weather-forecast.service.ts:21-70`)
- `getCached(city, forecastDate, metric)` → `ForecastResult | null`
- `save(result)` → persiste en DB
- Exporté depuis `core/src/services/index.ts:151-154` puis `core/src/index.ts`

### Fonction de fetch existante (`weather-api-client.ts:181-215`)
```typescript
export async function fetchWeatherForecast(
  city: string,
  targetDate: Date,
  metric: 'highest_temp' | 'lowest_temp',
): Promise<{ forecastMean; forecastStdDev; modelValues; latitude; longitude } | null>
```
Exporté depuis `core/src/index.ts:257-265`.

### Discovery existante (`weather-market-discovery.ts:21-89`)
```typescript
export async function discoverWeatherMarkets(options): Promise<WeatherMarketDiscoveryResult>
// retourne { temperatureMarkets, allWeatherMarkets, byCity: CityMarketGroup[] }
```

### Type `CityMarketGroup` (`weather-market-discovery.ts:128-131`)
```typescript
export interface CityMarketGroup {
  city: string;
  markets: MarketListItemDto[];
}
```

### `MarketListItemDto.endDate` (`market-list.ts:16`)
Chaîne ISO. Utilisée comme date cible si le parsing de la question n'a pas de `dateString` fiable.

### Import actuel dans `weather-market-discovery.ts` (ligne 5)
```typescript
import { parseWeatherQuestion } from './question-parser.js';
```
`resolveWeatherDate` existe dans `question-parser.ts:100` mais n'est **pas** importé ici actuellement.

### Backend — variable DataSource (`backend/src/index.ts:179-182`)
```typescript
app.use('/api/weather-algo-discover', jwtLimiter, createWeatherAlgoDiscoverRouter());  // ← pas de ds !
app.use('/api/weather-algo-forecasts', jwtLimiter, createWeatherAlgoForecastsRouter(ds));  // ← ds
```
La variable s'appelle **`ds`** dans tout le backend, pas `dataSource`.

### Frontend `WeatherCityGroup` (`WeatherCityGroup.tsx:3-10`)
```typescript
export interface WeatherCityGroupProps<T> {
  city: string;
  markets: T[];
  renderItem: (item: T) => any;
  defaultExpanded?: boolean;
}
```
Actuellement le header affiche : chevron + city + count.

---

## Approche

1. **Core** — Nouveau type `ForecastEnrichedCityGroup` avec champs forecast, + fonction `resolveGroupTargetDate()` pour déterminer la date cible d'un groupe.
2. **Core** — Nouvelle fonction `enrichCityGroupsWithForecast(ds, groups, metric)` :
   - Pour chaque groupe, résoudre la date cible
   - Appeler `WeatherForecastService.getCached()` en parallèle
   - Pour les cache miss, appeler `fetchWeatherForecast()` en parallèle, puis sauvegarder
   - Retourner les groupes enrichis avec un `forecastStatus` (`fresh`, `stale`, `unavailable`)
3. **Core** — Export du nouveau type et fonction via `index.ts`.
4. **Backend** — Modifier `createWeatherAlgoDiscoverRouter(ds)` pour accepter `DataSource`, appeler `enrichCityGroupsWithForecast()` sur `result.byCity`, retourner `byCity` enrichi.
5. **Frontend** — Mettre à jour `CityMarketGroup` pour inclure les champs forecast.
6. **Frontend** — `WeatherCityGroup` : afficher la température dans le header (format "31.5°C" ou "—" si indisponible).
7. **Frontend** — CSS : style pour la température dans le header (couleur, monospace).
8. **Tests + build + validation**.

---

## Phase 1 — Core : types et helper de résolution de date

### Task 1.1: Ajouter `ForecastEnrichedCityGroup` et `resolveGroupTargetDate`

**Objective:** Définir le type enrichi et une fonction qui détermine la date cible d'un groupe à partir de ses marchés.

**Files:**
- Modify: `packages/core/src/weather/weather-market-discovery.ts`

**Step 1: Corriger l'import existant**

Remplacer la ligne 5 :

```typescript
import { parseWeatherQuestion } from './question-parser.js';
```

Par :

```typescript
import { parseWeatherQuestion, resolveWeatherDate } from './question-parser.js';
```

**Step 2: Ajouter le type et la fonction helper**

Ajouter après l'interface `CityMarketGroup` (ligne 131) :

```typescript
export type ForecastStatus = 'fresh' | 'stale' | 'unavailable';

export interface ForecastEnrichedCityGroup extends CityMarketGroup {
  /** ISO date string (YYYY-MM-DD) for which the forecast applies. */
  targetDate: string;
  /** Forecast mean temperature in °C. Null when no forecast is available. */
  forecastMean: number | null;
  /** Forecast standard deviation in °C. Null when no forecast is available. */
  forecastStdDev: number | null;
  /** Source status for the displayed forecast. */
  forecastStatus: ForecastStatus;
}

/**
 * Resolve the canonical target date for a city group.
 * Prefers the parsed dateString from the first parsable market question.
 * Falls back to the first market endDate.
 * Final fallback: tomorrow (J+1) — consistent with discoverWeatherMarkets default.
 */
export function resolveGroupTargetDate(group: CityMarketGroup): Date {
  for (const m of group.markets) {
    if (m.question) {
      const parsed = parseWeatherQuestion(m.question);
      if (parsed) {
        const resolved = resolveWeatherDate(parsed.dateString);
        if (!Number.isNaN(resolved.getTime())) return resolved;
      }
    }
    if (m.endDate) {
      const d = new Date(m.endDate);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  // Final fallback: tomorrow (J+1), consistent with discoverWeatherMarkets default.
  return defaultTomorrow();
}
```

**Step 3: Build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

## Phase 2 — Core : fonction d'enrichissement forecast

### Task 2.1: Créer `enrichCityGroupsWithForecast`

**Objective:** Enrichir `CityMarketGroup[]` avec les forecasts par ville/date, en utilisant cache + Open-Meteo en parallèle.

**Files:**
- Create: `packages/core/src/weather/weather-forecast-enricher.ts`
- Modify: `packages/core/src/index.ts` (export)

**Step 1: Créer le fichier d'enrichissement**

> **Important :** Les imports doivent pointer vers les **fichiers source directs**, pas vers le barrel `../index.js`. Importer depuis le barrel tirerait tout le core (typeorm, entities, etc.) dans un module weather — lourd et mauvaise pratique.

```typescript
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastService, type ForecastResult } from '../services/weather-forecast.service.js';
import { fetchWeatherForecast } from './weather-api-client.js';
import type {
  CityMarketGroup,
  ForecastEnrichedCityGroup,
  ForecastStatus,
} from './weather-market-discovery.js';
import { resolveGroupTargetDate } from './weather-market-discovery.js';

const log = pino({ name: 'core:weather-forecast-enricher' });

export interface EnrichForecastOptions {
  /** Metric to forecast. Default: highest_temp. */
  metric?: 'highest_temp' | 'lowest_temp';
  /** Cache TTL in ms. Default: 1 hour. */
  ttlMs?: number;
}

/**
 * Enrich city groups with Open-Meteo temperature forecasts.
 *
 * Flow per group:
 *   1. Resolve target date from market question / endDate.
 *   2. Try DB cache first.
 *   3. If cache miss or stale, fetch from Open-Meteo in parallel.
 *   4. Save fresh results to cache (fire-and-forget).
 *
 * All groups are processed in parallel to keep discovery latency low.
 */
export async function enrichCityGroupsWithForecast(
  ds: DataSource,
  groups: CityMarketGroup[],
  options: EnrichForecastOptions = {},
): Promise<ForecastEnrichedCityGroup[]> {
  const metric = options.metric ?? 'highest_temp';
  const ttlMs = options.ttlMs ?? 3600_000;
  const forecastService = new WeatherForecastService(ds);

  const enriched = await Promise.all(
    groups.map(async (group): Promise<ForecastEnrichedCityGroup> => {
      const targetDate = resolveGroupTargetDate(group);
      const targetDateStr = targetDate.toISOString().slice(0, 10);

      try {
        const cached = await forecastService.getCached(group.city, targetDate, metric);

        if (cached?.isFresh) {
          return {
            ...group,
            targetDate: targetDateStr,
            forecastMean: cached.forecastMean,
            forecastStdDev: cached.forecastStdDev,
            forecastStatus: 'fresh',
          };
        }

        const fresh = await fetchWeatherForecast(group.city, targetDate, metric);
        if (!fresh) {
          // Stale cache is better than nothing
          if (cached) {
            return {
              ...group,
              targetDate: targetDateStr,
              forecastMean: cached.forecastMean,
              forecastStdDev: cached.forecastStdDev,
              forecastStatus: 'stale',
            };
          }
          return {
            ...group,
            targetDate: targetDateStr,
            forecastMean: null,
            forecastStdDev: null,
            forecastStatus: 'unavailable',
          };
        }

        const result: ForecastResult = {
          city: group.city,
          forecastDate: targetDate,
          metric,
          forecastMean: fresh.forecastMean,
          forecastStdDev: fresh.forecastStdDev,
          modelValues: fresh.modelValues,
          latitude: fresh.latitude,
          longitude: fresh.longitude,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMs),
          isFresh: true,
        };

        // Save to cache without blocking the response
        forecastService.save(result).catch((err) => {
          log.warn({ err, city: group.city, date: targetDateStr }, 'failed to save forecast cache');
        });

        return {
          ...group,
          targetDate: targetDateStr,
          forecastMean: fresh.forecastMean,
          forecastStdDev: fresh.forecastStdDev,
          forecastStatus: 'fresh',
        };
      } catch (err) {
        log.warn({ err, city: group.city, date: targetDateStr }, 'forecast enrichment failed for city');
        return {
          ...group,
          targetDate: targetDateStr,
          forecastMean: null,
          forecastStdDev: null,
          forecastStatus: 'unavailable',
        };
      }
    }),
  );

  return enriched;
}
```

**Step 2: Exporter depuis le core**

Dans `packages/core/src/index.ts`, ajouter après la ligne 256 (export de `parseWeatherQuestion`) :

```typescript
export {
  enrichCityGroupsWithForecast,
  type EnrichForecastOptions,
} from './weather/weather-forecast-enricher.js';
export type { ForecastEnrichedCityGroup, ForecastStatus } from './weather/weather-market-discovery.js';
```

> **Note :** `ForecastEnrichedCityGroup` et `ForecastStatus` sont déjà définis dans `weather-market-discovery.ts` qui est déjà exporté à la ligne 255. On ajoute l'export explicite des types ici pour éviter que le barrel ne les rate.

En réalité, comme `weather-market-discovery.ts` est déjà exporté avec `type CityMarketGroup` à la ligne 255, on peut simplement ajouter les nouveaux types à cette même ligne :

Remplacer la ligne 255 :

```typescript
export { discoverWeatherMarkets, groupMarketsByEvent, groupMarketsByCity, WEATHER_TAG_SLUG, type WeatherMarketDiscoveryResult, type CityMarketGroup } from './weather/weather-market-discovery.js';
```

Par :

```typescript
export { discoverWeatherMarkets, groupMarketsByEvent, groupMarketsByCity, resolveGroupTargetDate, WEATHER_TAG_SLUG, type WeatherMarketDiscoveryResult, type CityMarketGroup, type ForecastEnrichedCityGroup, type ForecastStatus } from './weather/weather-market-discovery.js';
export { enrichCityGroupsWithForecast, type EnrichForecastOptions } from './weather/weather-forecast-enricher.js';
```

**Step 3: Build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 2.2: Tests unitaires pour l'enrichissement

**Objective:** Vérifier que l'enrichissement fonctionne avec cache, sans cache, et en cas d'erreur.

**Files:**
- Create: `packages/core/src/weather/weather-forecast-enricher.test.ts`

> **Important :** Les mocks doivent cibler les **fichiers source directs** (`./weather-api-client.js`), pas le barrel `../index.js`. Sinon le mock ne sera pas appliqué.

**Step 1: Écrire les tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { enrichCityGroupsWithForecast } from './weather-forecast-enricher.js';
import type { CityMarketGroup } from './weather-market-discovery.js';

// Mock fetchWeatherForecast at the source module level
vi.mock('./weather-api-client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./weather-api-client.js')>();
  return {
    ...mod,
    fetchWeatherForecast: vi.fn(),
  };
});

// Import the mocked function for assertion
import { fetchWeatherForecast } from './weather-api-client.js';

function makeGroup(city: string, question: string): CityMarketGroup {
  return {
    city,
    markets: [{
      conditionId: 'c1',
      question,
      eventSlug: null,
      slug: null,
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
    }],
  };
}

/** Mock DataSource with a repository that returns cached forecast or null. */
function makeMockDs(cachedRow: any | null): any {
  const repo = {
    findOne: vi.fn().mockResolvedValue(cachedRow),
    save: vi.fn().mockResolvedValue(undefined),
  };
  return { getRepository: () => repo } as any;
}

describe('enrichCityGroupsWithForecast', () => {
  it('uses fresh cache and skips external call', async () => {
    const ds = makeMockDs({
      city: 'Hong Kong',
      forecastDate: new Date('2026-07-25'),
      metric: 'highest_temp',
      forecastMean: 31.5,
      forecastStdDev: 0.8,
      modelValues: '{}',
      latitude: 22.3,
      longitude: 114.1,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000), // fresh
    });

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result).toHaveLength(1);
    expect(result[0].forecastMean).toBe(31.5);
    expect(result[0].forecastStatus).toBe('fresh');
    expect(fetchWeatherForecast).not.toHaveBeenCalled();
  });

  it('fetches externally on cache miss', async () => {
    const ds = makeMockDs(null);
    vi.mocked(fetchWeatherForecast).mockResolvedValue({
      forecastMean: 29.2,
      forecastStdDev: 1.1,
      modelValues: { gfs: 29 },
      latitude: 22.3,
      longitude: 114.1,
    });

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBe(29.2);
    expect(result[0].forecastStatus).toBe('fresh');
  });

  it('marks forecast unavailable when external fetch fails and no cache', async () => {
    const ds = makeMockDs(null);
    vi.mocked(fetchWeatherForecast).mockResolvedValue(null);

    const groups = [makeGroup('UnknownCity', 'Will the highest temperature in UnknownCity be 20°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBeNull();
    expect(result[0].forecastStatus).toBe('unavailable');
  });

  it('returns stale cache when external fetch fails', async () => {
    const ds = makeMockDs({
      city: 'Hong Kong',
      forecastDate: new Date('2026-07-25'),
      metric: 'highest_temp',
      forecastMean: 30.0,
      forecastStdDev: 1.0,
      modelValues: '{}',
      latitude: 22.3,
      longitude: 114.1,
      fetchedAt: new Date(Date.now() - 7200_000), // 2h ago
      expiresAt: new Date(Date.now() - 3600_000), // expired → stale
    });
    vi.mocked(fetchWeatherForecast).mockResolvedValue(null);

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBe(30.0);
    expect(result[0].forecastStatus).toBe('stale');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run packages/core/src/weather/weather-forecast-enricher.test.ts`
Expected: PASS — 4 tests

---

## Phase 3 — Backend : route discover enrichie

### Task 3.1: Modifier `createWeatherAlgoDiscoverRouter` pour accepter `DataSource`

**Objective:** La route appelle `discoverWeatherMarkets()` puis enrichit `byCity` avec les forecasts.

**Files:**
- Modify: `packages/backend/src/routes/weather-algo-discover.ts`
- Modify: `packages/backend/src/index.ts` (injection)

**Step 1: Réécrire la route**

```typescript
import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { discoverWeatherMarkets, enrichCityGroupsWithForecast } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createWeatherAlgoDiscoverRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    try {
      const result = await discoverWeatherMarkets({
        limit: 100,
        offset: Number.isFinite(offset) ? offset : 0,
      });

      // Enrich city groups with Open-Meteo temperature forecasts for the UI headers.
      const byCity = await enrichCityGroupsWithForecast(ds, result.byCity, {
        metric: 'highest_temp',
      });

      res.json({
        ...result,
        byCity,
      });
    } catch (err) {
      res.status(500).json({
        error: 'discovery_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}
```

**Step 2: Mettre à jour l'injection dans `backend/src/index.ts`**

Dans `packages/backend/src/index.ts`, remplacer la ligne 180 :

```typescript
app.use('/api/weather-algo-discover', jwtLimiter, createWeatherAlgoDiscoverRouter());
```

Par :

```typescript
app.use('/api/weather-algo-discover, jwtLimiter, createWeatherAlgoDiscoverRouter(ds));
```

> **Note :** La variable s'appelle `ds` dans tout le backend (cf. lignes 147, 148, 179, 181, etc.), pas `dataSource`.

**Step 3: Build backend**

Run: `npm run build -w @polywatch/backend`
Expected: PASS

---

## Phase 4 — Frontend : types et hook

### Task 4.1: Mettre à jour `CityMarketGroup` pour inclure les champs forecast

**Objective:** Le type frontend reflète la réponse enrichie du backend.

**Files:**
- Modify: `packages/frontend/src/hooks/useWeatherAlgoDashboard.ts`

**Step 1: Étendre l'interface**

Remplacer :

```typescript
export interface CityMarketGroup {
  city: string;
  markets: DiscoverMarket[];
}
```

Par :

```typescript
export interface CityMarketGroup {
  city: string;
  markets: DiscoverMarket[];
  /** ISO target date for the forecast (YYYY-MM-DD). */
  targetDate: string;
  /** Forecast mean temperature in °C. Null if unavailable. */
  forecastMean: number | null;
  /** Forecast standard deviation in °C. Null if unavailable. */
  forecastStdDev: number | null;
  /** fresh = from cache or live fetch; stale = expired cache; unavailable = no data. */
  forecastStatus: 'fresh' | 'stale' | 'unavailable';
}
```

**Step 2: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 5 — Frontend : affichage dans `WeatherCityGroup`

### Task 5.1: Afficher la température dans le header

**Objective:** Le header du dropdown montre la ville, le compte, et la température de prédiction.

**Files:**
- Modify: `packages/frontend/src/components/WeatherCityGroup.tsx`
- Modify: `packages/frontend/src/components/WeatherAlgoDiscoverPanel.tsx`
- Modify: `packages/frontend/src/components/WeatherAlgoActiveMarketsPanel.tsx`

**Step 1: Étendre `WeatherCityGroup`**

Réécrire `packages/frontend/src/components/WeatherCityGroup.tsx` :

```tsx
import { createSignal, For, Show } from 'solid-js';

export interface WeatherCityGroupProps<T> {
  city: string;
  markets: T[];
  /** Forecast mean temperature in °C. Displayed in the header. */
  forecastMean: number | null;
  /** Forecast status drives styling/tooltip. */
  forecastStatus?: 'fresh' | 'stale' | 'unavailable';
  /** Render each market item inside the accordion body. */
  renderItem: (item: T) => any;
  /** Initial expanded state. Default: collapsed. */
  defaultExpanded?: boolean;
}

export function WeatherCityGroup<T>(props: WeatherCityGroupProps<T>) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  const forecastLabel = () => {
    if (props.forecastMean == null) return '—';
    return `${props.forecastMean.toFixed(1)}°C`;
  };

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
        <span
          class="weather-city-group__forecast"
          classList={{
            'weather-city-group__forecast--stale': props.forecastStatus === 'stale',
            'weather-city-group__forecast--unavailable': props.forecastStatus === 'unavailable',
          }}
          title={props.forecastStatus === 'unavailable' ? 'Prévision indisponible' : props.forecastStatus === 'stale' ? 'Prévision expirée' : undefined}
        >
          {forecastLabel()}
        </span>
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

**Step 2: Propager les props dans `WeatherAlgoDiscoverPanel`**

Dans `WeatherAlgoDiscoverPanel.tsx`, remplacer le bloc `<WeatherCityGroup>` :

```tsx
<WeatherCityGroup
  city={group.city}
  markets={group.markets}
  forecastMean={group.forecastMean}
  forecastStatus={group.forecastStatus}
  renderItem={(market: DiscoverMarket) => { ... }}
/>
```

**Step 3: Propager les props dans `WeatherAlgoActiveMarketsPanel`**

Dans `WeatherAlgoActiveMarketsPanel.tsx`, remplacer le bloc `<WeatherCityGroup>` :

```tsx
<WeatherCityGroup
  city={group.city}
  markets={group.items}
  forecastMean={null}
  forecastStatus="unavailable"
  defaultExpanded={true}
  renderItem={(sel: WeatherSelection) => { ... }}
/>
```

> **Note :** Active selections n'ont pas de date/forecast centralisé dans cette itération. On affiche "—" pour rester cohérent visuellement.

**Step 4: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 6 — CSS

### Task 6.1: Ajouter le style pour la température dans le header

**Objective:** Température visible et alignée à droite, couleur différente selon le statut.

**Files:**
- Modify: `packages/frontend/src/styles.css` (dans le bloc weather-city-group)

**Step 1: Ajouter les styles**

Après `.weather-city-group__count { ... }`, ajouter :

```css
.weather-city-group__forecast {
  font-size: .8125rem;
  font-weight: 700;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  padding: .125rem .45rem;
  background: var(--accent-muted);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.weather-city-group__forecast--stale {
  color: var(--warning);
  background: var(--warning-muted);
}

.weather-city-group__forecast--unavailable {
  color: var(--text-muted);
  background: var(--bg-elevated);
}
```

**Step 2: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase 7 — Documentation

### Task 7.1: Mettre à jour `docs/api.md`, `change.history.md`

**Files:**
- Modify: `docs/api.md`
- Modify: `change.history.md`

**Step 1: `docs/api.md`**

Remplacer la description de la route discover :

```markdown
| GET | `/api/weather-algo-discover?limit=50&offset=0` | Découvre les marchés météo Polymarket (`tag_slug=weather`) → `{temperatureMarkets, allWeatherMarkets, byCity: [{city, markets, targetDate, forecastMean, forecastStdDev, forecastStatus}]}` |
```

**Step 2: `change.history.md`**

Ajouter sous la dernière entrée 2026-07-24 :

```markdown
### Added
- Core: `resolveGroupTargetDate()` + `ForecastEnrichedCityGroup` + `ForecastStatus`
- Core: `enrichCityGroupsWithForecast()` — enrichit les groupes par ville avec les forecasts Open-Meteo (cache DB + fetch parallèle)
- Core: tests unitaires pour `enrichCityGroupsWithForecast`
- Backend: `createWeatherAlgoDiscoverRouter(ds)` — injection de `DataSource` + appel à l'enrichisseur
- Frontend: `CityMarketGroup` étendu avec `targetDate`, `forecastMean`, `forecastStdDev`, `forecastStatus`
- Frontend: `WeatherCityGroup` affiche la température de prédiction dans le header
- Frontend: CSS `.weather-city-group__forecast` (+ stale / unavailable)
- Docs: route discover mise à jour avec les champs forecast
```

---

## Phase 8 — Validation

### Task 8.1: Build complet + tests + validation visuelle

**Step 1: Tests**

Run: `npx vitest run packages/core/src/weather/`
Expected: PASS — tous les tests weather

**Step 2: Build**

Run: `npm run build`
Expected: PASS

**Step 3: Dev server**

Run: `npm run dev -w @polywatch/frontend`
Expected: démarre sans erreur

**Step 4: Vérification visuelle**

- [ ] Ouvrir la page Weather Algo → onglet Marchés
- [ ] Les headers des dropdowns affichent : ville + température (ex: "Hong Kong 31.5°C 5")
- [ ] Si température indisponible, affichage "—" en gris
- [ ] Cliquer sur "Rafraîchir" recharge les groupes + forecasts
- [ ] Aucune erreur console

---

## Risques et tradeoffs

1. **Latence discover** : chaque appel à `/weather-algo-discover` va potentiellement appeler Open-Meteo N fois (une par ville). Mitigations :
   - Cache DB utilisé en premier
   - Appels parallèles (`Promise.all`)
   - TTL de 1 heure par défaut
   - Si Open-Meteo est down, la route retourne quand même les groupes avec `forecastStatus: unavailable`

2. **Géocoding** : `fetchWeatherForecast` appelle d'abord `geocodeCity()`. Si le nom de ville du marché Polymarket ne correspond pas à une ville Open-Meteo (ex: "Hong Kong" vs "Hong Kong Island"), le forecast peut échouer. C'est un risque connu déjà présent pour l'algo.

3. **Date cible** : on résout la date à partir du `question` parsé, puis du `endDate`. `resolveGroupTargetDate` centralise cette logique. Le fallback final utilise `defaultTomorrow()` (J+1) pour rester cohérent avec `discoverWeatherMarkets`.

4. **Active markets** : dans cette itération, les marchés suivis n'ont pas de forecast dans leur header (affichage "—"). Une amélioration future serait d'enrichir aussi les sélections actives côté backend.

5. **Breaking change API** : la route discover retourne maintenant des champs supplémentaires — c'est additif, pas cassant pour les consumers existants. `temperatureMarkets` et `allWeatherMarkets` restent inchangés.