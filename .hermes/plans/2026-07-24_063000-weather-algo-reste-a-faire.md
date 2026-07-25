# Weather Algo — Reste à faire Implementation Plan (v2 corrigé)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Compléter les 3 blocs manquants du plan weather-algo : (1) parser Fahrenheit + between, (2) composants frontend, (3) docs & validation.

**Architecture:** Le parser `question-parser.ts` doit reconnaître °C et °F, y compris le pattern "between X-Y°F". Les composants frontend suivent l'architecture des composants CryptoAlgo existants (SolidJS, props-down, hooks séparés). Les docs suivent le format existant de `docs/api.md` et `docs/architecture.md`.

**Tech Stack:** TypeScript, Vitest, SolidJS, Express.

---

## Contexte : patterns de questions Polymarket

D'après l'analyse de l'API Gamma, il existe ces patterns :

**°C (1452 marchés) — déjà supportés partiellement :**
- `"Will the highest temperature in Jinan be 25°C on May 20?"` (exact)
- `"Will the highest temperature in Jinan be 15°C or below on May 20?"` (or below)
- `"Will the highest temperature in Jinan be 25°C or higher on May 20?"` (or higher — non supporté actuellement !)

**°F (341 marchés) — non supportés :**
- `"Will the highest temperature in Seattle be 69°F or below on July 23?"` (or below)
- `"Will the highest temperature in Seattle be between 74-75°F on July 23?"` (between — nouveau pattern !)
- `"Will the highest temperature in Seattle be 88°F or higher on July 23?"` (or higher)

**Pattern "between" absent en °C** — seulement en °F. Mais le parser doit quand même le supporter pour robustesse future.

## Corrections vs v1 (important)

Le plan v1 avait 7 erreurs identifiées lors de la vérification :

1. **`targetValue` non-nullable pour exact/or_below/or_above** — les consumers (`weather-forecast.strategy.ts:52`, `weather-market-selection.service.ts:84`) lisent `parsed.targetValue` directement. On garde `targetValue: number` pour ces cas, `null` seulement pour `between`.
2. **`computeMarketImpliedProbabilities` ne supporte pas `between`** — il faut étendre cette fonction dans `forecast-distribution.ts`.
3. **Bug d'index regex** — les regex avec capture d'unité `([CF])` décalent tous les groupes. Corrigé ci-dessous.
4. **`CopiedPosition` n'a pas de `traderAddress`** — filtrer par `reason LIKE 'WEATHER_%'` à la place.
5. **`Execution` n'a pas de `traderAddress`** — filtrer par `reason LIKE 'WEATHER_%'` à la place.
6. **Backend utilise `PUT` pas `PATCH`** pour risk-config — corriger en `PUT`.
7. **`riskConfigUpdateSchema` n'inclut pas les champs `weatherAlgo*`** — il faut les ajouter au schema zod dans `config.ts`.

---

## Phase A — Parser Fahrenheit + Between (TDD)

### Task A.1: Étendre le parser pour supporter °F, "or higher" et "between"

**Objective:** Le parser reconnaît °C et °F, tous les comparateurs (exact, or below, or higher, between), et retourne l'unité + la valeur convertie en Celsius.

**Files:**
- Modify: `packages/core/src/weather/question-parser.ts`
- Modify: `packages/core/src/weather/question-parser.test.ts`

**Step 1: Écrire les tests échouants**

Ajouter à `packages/core/src/weather/question-parser.test.ts` :

```typescript
  it('parses °F "or below" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be 69°F or below on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeCloseTo(20.6, 0); // 69°F ≈ 20.56°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('or_below');
    expect(result!.dateString).toBe('July 23');
  });

  it('parses °F "between" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be between 74-75°F on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeNull();
    expect(result!.targetValueLow).toBeCloseTo(23.3, 0); // 74°F ≈ 23.33°C
    expect(result!.targetValueHigh).toBeCloseTo(23.9, 0); // 75°F ≈ 23.89°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('between');
    expect(result!.dateString).toBe('July 23');
  });

  it('parses °F "or higher" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be 88°F or higher on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeCloseTo(31.1, 0); // 88°F ≈ 31.11°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('or_above');
  });

  it('parses °C "or higher" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be 25°C or higher on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(25);
    expect(result!.unit).toBe('celsius');
    expect(result!.comparison).toBe('or_above');
  });

  it('parses °C "between" variant (future-proofing)', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be between 20-21°C on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeNull();
    expect(result!.targetValueLow).toBe(20);
    expect(result!.targetValueHigh).toBe(21);
    expect(result!.comparison).toBe('between');
  });
```

**Step 2: Lancer les tests pour vérifier l'échec**

Run: `npx vitest run packages/core/src/weather/question-parser.test.ts`
Expected: FAIL — 5 nouveaux tests échouent

**Step 3: Modifier l'interface et l'implémentation**

Modifier `packages/core/src/weather/question-parser.ts` :

```typescript
export interface ParsedWeatherQuestion {
  city: string;
  metric: 'highest_temp' | 'lowest_temp';
  /** Target temperature in Celsius. Non-null for exact, or_below, or_above. Null for between. */
  targetValue: number | null;
  /** Low bound in Celsius. Only set for 'between' comparison. Null otherwise. */
  targetValueLow: number | null;
  /** High bound in Celsius. Only set for 'between' comparison. Null otherwise. */
  targetValueHigh: number | null;
  dateString: string;
  comparison: 'exact' | 'or_below' | 'or_above' | 'between';
  /** Original unit in the question. */
  unit: 'celsius' | 'fahrenheit';
}

/** Convert Fahrenheit to Celsius, rounded to 1 decimal. */
function fToC(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

// Regex for exact / or below / or above patterns.
// Groups: 1=city, 2=value, 3=unit(C/F), 4=below/above(optional), 5=date
const HIGHEST_TEMP_REGEX_OR =
  /highest temperature in (.+?) be (-?\d+)°([CF])(?: or (below|above))? on (.+?)\?/i;
const LOWEST_TEMP_REGEX_OR =
  /lowest temperature in (.+?) be (-?\d+)°([CF])(?: or (below|above))? on (.+?)\?/i;

// Regex for "between X-Y°" pattern.
// Groups: 1=city, 2=low value, 3=high value, 4=unit(C/F), 5=date
const HIGHEST_TEMP_REGEX_BETWEEN =
  /highest temperature in (.+?) be between (-?\d+)-(-?\d+)°([CF]) on (.+?)\?/i;
const LOWEST_TEMP_REGEX_BETWEEN =
  /lowest temperature in (.+?) be between (-?\d+)-(-?\d+)°([CF]) on (.+?)\?/i;

function buildOrResult(
  match: RegExpExecArray,
  metric: 'highest_temp' | 'lowest_temp',
): ParsedWeatherQuestion {
  const unit = match[3]!.toLowerCase() === 'f' ? 'fahrenheit' : 'celsius';
  const rawVal = parseInt(match[2]!, 10);
  const comparison: ParsedWeatherQuestion['comparison'] = match[4]
    ? (match[4].toLowerCase() === 'below' ? 'or_below' : 'or_above')
    : 'exact';
  return {
    city: match[1]!.trim(),
    metric,
    targetValue: unit === 'fahrenheit' ? fToC(rawVal) : rawVal,
    targetValueLow: null,
    targetValueHigh: null,
    dateString: match[5]!.trim(),
    comparison,
    unit,
  };
}

function buildBetweenResult(
  match: RegExpExecArray,
  metric: 'highest_temp' | 'lowest_temp',
): ParsedWeatherQuestion {
  const unit = match[4]!.toLowerCase() === 'f' ? 'fahrenheit' : 'celsius';
  const lowRaw = parseInt(match[2]!, 10);
  const highRaw = parseInt(match[3]!, 10);
  return {
    city: match[1]!.trim(),
    metric,
    targetValue: null,
    targetValueLow: unit === 'fahrenheit' ? fToC(lowRaw) : lowRaw,
    targetValueHigh: unit === 'fahrenheit' ? fToC(highRaw) : highRaw,
    dateString: match[5]!.trim(),
    comparison: 'between',
    unit,
  };
}

export function parseWeatherQuestion(
  question: string,
): ParsedWeatherQuestion | null {
  // Try "between" pattern first (more specific)
  const betweenHighest = HIGHEST_TEMP_REGEX_BETWEEN.exec(question);
  if (betweenHighest) return buildBetweenResult(betweenHighest, 'highest_temp');

  const betweenLowest = LOWEST_TEMP_REGEX_BETWEEN.exec(question);
  if (betweenLowest) return buildBetweenResult(betweenLowest, 'lowest_temp');

  // Try "exact / or below / or above" pattern
  const highestOr = HIGHEST_TEMP_REGEX_OR.exec(question);
  if (highestOr) return buildOrResult(highestOr, 'highest_temp');

  const lowestOr = LOWEST_TEMP_REGEX_OR.exec(question);
  if (lowestOr) return buildOrResult(lowestOr, 'lowest_temp');

  return null;
}
```

**Step 4: Mettre à jour les tests existants pour l'interface renommée**

Les tests existants utilisent `result!.targetValue` qui reste `number` pour les cas exact/or_below. Ajouter les assertions manquantes (`unit`, `targetValueLow`, `targetValueHigh`, `comparison`) :

```typescript
  it('parses "highest temperature in Hong Kong be 31°C on July 24"', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Hong Kong be 31°C on July 24?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Hong Kong');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(31);
    expect(result!.dateString).toBe('July 24');
    expect(result!.unit).toBe('celsius');
    expect(result!.comparison).toBe('exact');
    expect(result!.targetValueLow).toBeNull();
    expect(result!.targetValueHigh).toBeNull();
  });
```

Faire de même pour les 3 autres tests existants.

**Step 5: Lancer les tests pour vérifier le succès**

Run: `npx vitest run packages/core/src/weather/question-parser.test.ts`
Expected: PASS — 9 tests (4 existants mis à jour + 5 nouveaux)

**Step 6: Vérifier le build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task A.2: Étendre `computeMarketImpliedProbabilities` pour le cas "between"

**Objective:** La fonction `computeMarketImpliedProbabilities` dans `forecast-distribution.ts` ne supporte que `exact`, `or_below`, `or_above`. Ajouter le cas `between`.

**Files:**
- Modify: `packages/core/src/weather/forecast-distribution.ts:82-103`

**Step 1: Ajouter le cas `between` à `computeMarketImpliedProbabilities`**

```typescript
export function computeMarketImpliedProbabilities(
  target: number | null,
  comparison: 'exact' | 'or_below' | 'or_above' | 'between',
  forecastMean: number,
  forecastStdDev: number,
  targetLow?: number | null,
  targetHigh?: number | null,
): { yesProb: number; noProb: number } {
  if (comparison === 'between') {
    const low = targetLow ?? target ?? 0;
    const high = targetHigh ?? target ?? 0;
    // YES = P(low - 0.5 < temp <= high + 0.5)
    const yesProb = Math.max(
      0,
      normalCDF(high + 0.5, forecastMean, forecastStdDev) -
        normalCDF(low - 0.5, forecastMean, forecastStdDev),
    );
    return { yesProb, noProb: 1 - yesProb };
  }
  if (comparison === 'or_below') {
    const yesProb = computeCdfBelow(target!, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  if (comparison === 'or_above') {
    const yesProb = computeCdfAbove(target!, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  // exact
  const yesProb = Math.max(
    0,
    normalCDF(target! + 0.5, forecastMean, forecastStdDev) -
      normalCDF(target! - 0.5, forecastMean, forecastStdDev),
  );
  return { yesProb, noProb: 1 - yesProb };
}
```

**Step 2: Build core**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task A.3: Mettre à jour les consumers du parser pour gérer `targetValue: null` et `between`

**Objective:** Trois fichiers utilisent `parsed.targetValue` et doivent gérer le cas `between` où `targetValue` est `null`.

**Files:**
- Modify: `packages/weather-algo/src/strategy/weather-forecast.strategy.ts:50-56,62,122`
- Modify: `packages/core/src/services/weather-market-selection.service.ts:77-86`

**Step 1: Mettre à jour `weather-forecast.strategy.ts`**

Remplacer l'appel à `computeMarketImpliedProbabilities` (lignes 50-56) pour passer les nouveaux paramètres :

```typescript
    const { yesProb: forecastYesProb, noProb: forecastNoProb } =
      computeMarketImpliedProbabilities(
        parsed.targetValue,
        parsed.comparison,
        ctx.forecastMean,
        ctx.forecastStdDev,
        parsed.targetValueLow,
        parsed.targetValueHigh,
      );
```

Corriger le detail d'abstain (ligne 62) pour gérer `null` :

```typescript
        detail: `target=${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`} comparison=${parsed.comparison}`,
```

Corriger les reasons (ligne 122) pour gérer `null` :

```typescript
        `forecast=${parsed.metric}:${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`}°C`,
```

**Step 2: Mettre à jour `weather-market-selection.service.ts`**

Lignes 77-86, gérer `null` :

```typescript
      if (!result.city || !result.metric || result.targetValue == null) {
        const parsed = market.question
          ? parseWeatherQuestion(market.question)
          : null;
        if (parsed) {
          result.city = result.city ?? parsed.city;
          result.metric = result.metric ?? parsed.metric;
          if (result.targetValue == null) {
            result.targetValue = parsed.targetValue;
          }
          if (parsed.comparison === 'between' && parsed.targetValueLow != null) {
            // For between, store the midpoint as targetValue
            result.targetValue = result.targetValue ??
              Math.round((parsed.targetValueLow! + parsed.targetValueHigh!) / 2 * 10) / 10;
          }
        }
      }
```

**Step 3: Build**

Run: `npm run build -w @polywatch/core -w @polywatch/weather-algo`
Expected: PASS

---

### Task A.4: Mettre à jour `hasTemperatureQuestion` dans le frontend

**Objective:** Remplacer la fonction locale `hasTemperatureQuestion` dans `WeatherAlgoPage.tsx` par un appel au parser réel depuis `@polywatch/core`.

**Files:**
- Modify: `packages/frontend/src/components/WeatherAlgoPage.tsx`

**Step 1: Importer le parser et remplacer**

Ajouter l'import :
```typescript
import { parseWeatherQuestion } from '@polywatch/core';
```

Dans `discoverMarkets()`, remplacer :
```typescript
parsed: hasTemperatureQuestion(m.question),
```
par :
```typescript
parsed: m.question ? parseWeatherQuestion(m.question) !== null : false,
```

Supprimer la fonction `hasTemperatureQuestion` locale (lignes 42-49).

**Step 2: Build frontend**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase B — Composants Frontend

### Task B.1: Ajouter les champs `weatherAlgo*` au `riskConfigUpdateSchema`

**Objective:** Le schema zod dans `config.ts` est `.strict()` — il rejette les champs inconnus. Sans cette étape, le `WeatherAlgoSettingsTab` ne peut pas sauvegarder.

**Files:**
- Modify: `packages/backend/src/routes/config.ts` (ajouter avant `.partial().strict()` à la ligne 240)

**Step 1: Ajouter les champs weather au schema**

Avant la ligne `.partial().strict()` (ligne 241), ajouter :

```typescript
    weatherAlgoEnabled: z.boolean(),
    weatherAlgoMinEdge: z.number().finite().min(0.01).max(0.50),
    weatherAlgoMaxForecastStd: z.number().finite().min(0).max(20).nullable(),
    weatherAlgoSizingMode: z.enum(['fixed_usdc']),
    weatherAlgoEntryUsdc: z.number().finite().min(1).max(10000),
    weatherAlgoSelectionMode: z.enum(['single', 'multi', 'spread']),
    weatherAlgoMaxSignalsPerEvent: z.number().int().min(1).max(20),
    weatherAlgoForecastChangeThreshold: z.number().finite().min(0.5).max(20),
    weatherAlgoCloseBeforeResolutionHours: z.number().finite().min(0.5).max(168),
    weatherAlgoPollMs: z.number().int().min(60_000).max(86_400_000),
```

**Step 2: Build backend**

Run: `npm run build -w @polywatch/backend`
Expected: PASS

---

### Task B.2: Créer `useWeatherAlgoDashboard` hook

**Objective:** Hook central qui gère l'état du dashboard weather-algo (sélections, statut, discovery, polling).

**Files:**
- Create: `packages/frontend/src/hooks/useWeatherAlgoDashboard.ts`

```typescript
import { createSignal, onCleanup, onMount } from 'solid-js';
import { api, apiText } from '../api';
import { onGlobalRefresh } from '../socket';

export interface WeatherSelection {
  id: number;
  conditionId: string;
  question: string | null;
  eventSlug: string | null;
  city: string | null;
  targetDate: string | null;
  metric: string | null;
  targetValue: number | null;
  enabled: boolean;
}

export interface WeatherStatus {
  alive: boolean;
  lastSeenAt: string | null;
  enabledSelections: number;
  selectionsWithMarket: number;
  evaluableSelections: number;
  wsConnected: boolean | null;
  lastEvaluatedAt: string | null;
  lastSkipReason: string | null;
  lastSkipAt: string | null;
}

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

export interface AutoTrackRule {
  id: number;
  city: string;
  metric: string;
  lookAheadDays: number;
  enabled: boolean;
}

const STATUS_POLL_MS = 10_000;

export function useWeatherAlgoDashboard() {
  const [selections, setSelections] = createSignal<WeatherSelection[]>([]);
  const [status, setStatus] = createSignal<WeatherStatus | null>(null);
  const [discoverResults, setDiscoverResults] = createSignal<DiscoverMarket[]>([]);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [autoTrackRules, setAutoTrackRules] = createSignal<AutoTrackRule[]>([]);

  async function refreshSelections() {
    try {
      setSelections(await api<WeatherSelection[]>('/weather-algo-markets'));
    } catch { /* ignore */ }
  }

  async function refreshStatus() {
    try {
      setStatus(await api<WeatherStatus>('/weather-algo-markets/status'));
    } catch { /* ignore */ }
  }

  async function refreshAutoTrackRules() {
    try {
      setAutoTrackRules(await api<AutoTrackRule[]>('/weather-algo-auto-track'));
    } catch { /* ignore */ }
  }

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

  async function addMarket(conditionId: string, question: string, eventSlug: string | null) {
    await api('/weather-algo-markets', {
      method: 'POST',
      body: JSON.stringify({ conditionId, question, eventSlug }),
    });
    await refreshSelections();
  }

  async function toggleSelection(conditionId: string, enabled: boolean) {
    await api(`/weather-algo-markets/${conditionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await refreshSelections();
  }

  async function removeSelection(conditionId: string) {
    await apiText(`/weather-algo-markets/${conditionId}`, { method: 'DELETE' });
    await refreshSelections();
  }

  async function addAutoTrackRule(city: string, metric: string, lookAheadDays: number) {
    await api('/weather-algo-auto-track', {
      method: 'POST',
      body: JSON.stringify({ city, metric, lookAheadDays }),
    });
    await refreshAutoTrackRules();
  }

  async function removeAutoTrackRule(id: number) {
    await apiText(`/weather-algo-auto-track/${id}`, { method: 'DELETE' });
    await refreshAutoTrackRules();
  }

  async function toggleAutoTrackRule(id: number, enabled: boolean) {
    await api(`/weather-algo-auto-track/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await refreshAutoTrackRules();
  }

  onMount(() => {
    void refreshSelections();
    void refreshStatus();
    void discoverMarkets();
    void refreshAutoTrackRules();

    const poll = setInterval(() => {
      void refreshSelections();
      void refreshStatus();
    }, STATUS_POLL_MS);

    const unsub = onGlobalRefresh(() => {
      void refreshSelections();
      void refreshStatus();
    });

    onCleanup(() => {
      clearInterval(poll);
      unsub();
    });
  });

  return {
    selections, status, discoverResults, discoverLoading, autoTrackRules,
    discoverMarkets, addMarket, toggleSelection, removeSelection,
    addAutoTrackRule, removeAutoTrackRule, toggleAutoTrackRule,
    refreshSelections, refreshStatus,
  };
}
```

---

### Task B.3: Créer `WeatherAlgoHeader.tsx`

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoHeader.tsx`

```typescript
import { Show } from 'solid-js';
import type { WeatherStatus } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoHeaderProps {
  status: WeatherStatus | null;
}

export function WeatherAlgoHeader(props: WeatherAlgoHeaderProps) {
  return (
    <header class="weather-algo-header-v2">
      <div class="weather-algo-title-row">
        <h1 class="page-title-v2">🌤️ Weather Algo</h1>
        <Show when={props.status}>
          {(s) => (
            <span class={`algo-status-badge ${s().alive ? 'alive' : 'stopped'}`}>
              <span class="algo-status-dot" />
              {s().alive ? 'En ligne' : 'Arrêté'}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.status}>
        {(s) => (
          <div class="weather-algo-status-meta">
            <span>Sélections actives: {s().enabledSelections}</span>
            <Show when={s().lastSeenAt}>
              <span>Heartbeat: {new Date(s().lastSeenAt!).toLocaleTimeString()}</span>
            </Show>
            <Show when={s().lastEvaluatedAt}>
              <span>Dernière éval: {new Date(s().lastEvaluatedAt!).toLocaleTimeString()}</span>
            </Show>
            <Show when={s().lastSkipReason}>
              <span class="weather-algo-skip-reason">Skip: {s().lastSkipReason}</span>
            </Show>
          </div>
        )}
      </Show>
    </header>
  );
}
```

---

### Task B.4: Créer `WeatherAlgoDiscoverPanel.tsx`

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoDiscoverPanel.tsx`

```typescript
import { For, Show } from 'solid-js';
import { parseWeatherQuestion } from '@polywatch/core';
import type { DiscoverMarket } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoDiscoverPanelProps {
  results: DiscoverMarket[];
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

      <Show when={props.results.length === 0 && !props.loading}>
        <div class="algo-empty">Aucun marché météo trouvé sur Polymarket.</div>
      </Show>

      <For each={props.results.slice(0, 40)}>
        {(market) => {
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
      </For>
    </section>
  );
}
```

---

### Task B.5: Créer `WeatherAlgoActiveMarketsPanel.tsx`

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoActiveMarketsPanel.tsx`

```typescript
import { For, Show } from 'solid-js';
import type { WeatherSelection } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoActiveMarketsPanelProps {
  selections: WeatherSelection[];
  onToggle: (conditionId: string, enabled: boolean) => void;
  onRemove: (conditionId: string) => void;
}

export function WeatherAlgoActiveMarketsPanel(props: WeatherAlgoActiveMarketsPanelProps) {
  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Marchés suivis ({props.selections.length})</h2>
      </div>

      <Show when={props.selections.length === 0}>
        <div class="algo-empty">Aucun marché suivi. Découvrez et ajoutez des marchés ci-dessous.</div>
      </Show>

      <For each={props.selections}>
        {(sel) => (
          <div class="weather-selection-card" classList={{ 'weather-selection-card--disabled': !sel.enabled }}>
            <div class="weather-selection-card__header">
              <span class="weather-selection-card__city">{sel.city ?? 'N/A'}</span>
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
      </For>
    </section>
  );
}
```

---

### Task B.6: Créer `WeatherAlgoForecastPanel.tsx`

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoForecastPanel.tsx`

```typescript
import { createSignal, For, Show } from 'solid-js';
import { api } from '../api';

interface ForecastData {
  city: string;
  forecastDate: string;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: string;
  expiresAt: string;
  isFresh: boolean;
}

export function WeatherAlgoForecastPanel() {
  const [city, setCity] = createSignal('');
  const [date, setDate] = createSignal('');
  const [metric, setMetric] = createSignal('highest_temp');
  const [forecast, setForecast] = createSignal<ForecastData | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function fetchForecast() {
    const c = city().trim();
    const d = date().trim();
    if (!c || !d) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<ForecastData>(
        `/weather-algo-forecasts/${encodeURIComponent(c)}/${encodeURIComponent(d)}?metric=${metric()}`,
      );
      setForecast(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Prévisions météo</h2>
      </div>
      <div class="weather-forecast-form">
        <input type="text" placeholder="Ville (ex: Jinan)" value={city()}
          onInput={(e) => setCity(e.currentTarget.value)} />
        <input type="date" value={date()}
          onInput={(e) => setDate(e.currentTarget.value)} />
        <select value={metric()} onChange={(e) => setMetric(e.currentTarget.value)}>
          <option value="highest_temp">Temp max</option>
          <option value="lowest_temp">Temp min</option>
        </select>
        <button class="btn btn-sm btn-primary" onClick={() => fetchForecast()} disabled={loading()}>
          {loading() ? '...' : 'Obtenir'}
        </button>
      </div>
      <Show when={error()}>
        <div class="algo-empty">Erreur: {error()}</div>
      </Show>
      <Show when={forecast()}>
        {(f) => (
          <div class="weather-forecast-result">
            <div class="weather-forecast-summary">
              <span>Mean: {f().forecastMean.toFixed(1)}°C</span>
              <span>StdDev: {f().forecastStdDev.toFixed(2)}°C</span>
              <span classList={{ 'weather-forecast-stale': !f().isFresh }}>
                {f().isFresh ? 'Frais' : 'Expiré'}
              </span>
            </div>
            <div class="weather-forecast-models">
              <For each={Object.entries(f().modelValues)}>
                {([model, value]) => (
                  <span class="weather-forecast-model">{model}: {value.toFixed(1)}°C</span>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}
```

---

### Task B.7: Créer `WeatherAlgoAutoTrackTab.tsx`

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoAutoTrackTab.tsx`

```typescript
import { createSignal, For, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoAutoTrackTabProps {
  rules: AutoTrackRule[];
  onAdd: (city: string, metric: string, lookAheadDays: number) => void;
  onRemove: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
}

export function WeatherAlgoAutoTrackTab(props: WeatherAlgoAutoTrackTabProps) {
  const [city, setCity] = createSignal('');
  const [metric, setMetric] = createSignal('highest_temp');
  const [lookAhead, setLookAhead] = createSignal(1);

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Auto-track rules</h2>
      </div>
      <div class="weather-autotrack-form">
        <input type="text" placeholder="Ville (ex: Jinan)" value={city()}
          onInput={(e) => setCity(e.currentTarget.value)} />
        <select value={metric()} onChange={(e) => setMetric(e.currentTarget.value)}>
          <option value="highest_temp">Temp max</option>
          <option value="lowest_temp">Temp min</option>
        </select>
        <input type="number" min="1" max="30" value={lookAhead()}
          onInput={(e) => setLookAhead(Number(e.currentTarget.value) || 1)} />
        <button class="btn btn-sm btn-primary" onClick={() => {
          if (city().trim()) { props.onAdd(city().trim(), metric(), lookAhead()); setCity(''); }
        }}>+ Ajouter</button>
      </div>
      <Show when={props.rules.length === 0}>
        <div class="algo-empty">Aucune règle auto-track.</div>
      </Show>
      <For each={props.rules}>
        {(rule) => (
          <div class="weather-autotrack-row" classList={{ 'weather-autotrack-row--disabled': !rule.enabled }}>
            <span>{rule.city}</span>
            <span>{rule.metric}</span>
            <span>J+{rule.lookAheadDays}</span>
            <button class="btn btn-sm btn-ghost" onClick={() => props.onToggle(rule.id, !rule.enabled)}>
              {rule.enabled ? 'Désactiver' : 'Activer'}
            </button>
            <button class="btn btn-sm btn-ghost" onClick={() => props.onRemove(rule.id)}>Supprimer</button>
          </div>
        )}
      </For>
    </section>
  );
}
```

---

### Task B.8: Créer `WeatherAlgoSettingsTab.tsx`

**Objective:** Onglet de gestion des champs RiskConfig weather. Utilise `PUT /risk-config` (pas PATCH). Charge la config complète, modifie les champs weather, renvoie le tout.

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx`

```typescript
import { createSignal, Show } from 'solid-js';
import { api } from '../api';

export function WeatherAlgoSettingsTab() {
  const [config, setConfig] = createSignal<Record<string, unknown> | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  async function loadConfig() {
    try {
      setConfig(await api<Record<string, unknown>>('/risk-config'));
    } catch { /* ignore */ }
    setLoaded(true);
  }

  async function saveConfig() {
    const c = config();
    if (!c) return;
    setSaving(true);
    try {
      // PUT /risk-config accepts partial fields (schema is .partial())
      await api('/risk-config', {
        method: 'PUT',
        body: JSON.stringify({
          weatherAlgoEnabled: c.weatherAlgoEnabled,
          weatherAlgoMinEdge: c.weatherAlgoMinEdge,
          weatherAlgoMaxForecastStd: c.weatherAlgoMaxForecastStd,
          weatherAlgoSizingMode: c.weatherAlgoSizingMode,
          weatherAlgoEntryUsdc: c.weatherAlgoEntryUsdc,
          weatherAlgoSelectionMode: c.weatherAlgoSelectionMode,
          weatherAlgoMaxSignalsPerEvent: c.weatherAlgoMaxSignalsPerEvent,
          weatherAlgoForecastChangeThreshold: c.weatherAlgoForecastChangeThreshold,
          weatherAlgoCloseBeforeResolutionHours: c.weatherAlgoCloseBeforeResolutionHours,
          weatherAlgoPollMs: c.weatherAlgoPollMs,
        }),
      });
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (!loaded()) void loadConfig();

  function update<K extends string>(key: K, value: unknown) {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Paramètres Weather Algo</h2>
        <button class="btn btn-sm btn-primary" onClick={() => saveConfig()} disabled={saving()}>
          {saving() ? '...' : 'Sauvegarder'}
        </button>
      </div>
      <Show when={config()}>
        {(c) => (
          <div class="weather-settings-grid">
            <label>
              <input type="checkbox" checked={c().weatherAlgoEnabled as boolean}
                onInput={(e) => update('weatherAlgoEnabled', e.currentTarget.checked)} />
              Algo activé
            </label>
            <label>
              Edge minimum ({((c().weatherAlgoMinEdge as number) * 100).toFixed(0)}%)
              <input type="range" min="0.05" max="0.30" step="0.01"
                value={c().weatherAlgoMinEdge as number}
                onInput={(e) => update('weatherAlgoMinEdge', Number(e.currentTarget.value))} />
            </label>
            <label>
              Std dev max (°C, vide = illimité)
              <input type="number" step="0.5"
                value={c().weatherAlgoMaxForecastStd ?? ''}
                onInput={(e) => update('weatherAlgoMaxForecastStd',
                  e.currentTarget.value ? Number(e.currentTarget.value) : null)} />
            </label>
            <label>
              USDC par entrée
              <input type="number" step="1" value={c().weatherAlgoEntryUsdc as number}
                onInput={(e) => update('weatherAlgoEntryUsdc', Number(e.currentTarget.value))} />
            </label>
            <label>
              Mode de sélection
              <select value={c().weatherAlgoSelectionMode as string}
                onChange={(e) => update('weatherAlgoSelectionMode', e.currentTarget.value)}>
                <option value="single">Single (meilleur edge)</option>
                <option value="multi">Multi (top N)</option>
                <option value="spread">Spread (adjacent)</option>
              </select>
            </label>
            <label>
              Max signaux par event (mode multi)
              <input type="number" min="1" max="20"
                value={c().weatherAlgoMaxSignalsPerEvent as number}
                onInput={(e) => update('weatherAlgoMaxSignalsPerEvent', Number(e.currentTarget.value))} />
            </label>
            <label>
              Seuil drift forecast (°C)
              <input type="number" step="0.5"
                value={c().weatherAlgoForecastChangeThreshold as number}
                onInput={(e) => update('weatherAlgoForecastChangeThreshold', Number(e.currentTarget.value))} />
            </label>
            <label>
              Auto-close avant résolution (heures)
              <input type="number" step="0.5"
                value={c().weatherAlgoCloseBeforeResolutionHours as number}
                onInput={(e) => update('weatherAlgoCloseBeforeResolutionHours', Number(e.currentTarget.value))} />
            </label>
          </div>
        )}
      </Show>
    </section>
  );
}
```

---

### Task B.9: Créer `WeatherAlgoPositionsPanel.tsx`, `WeatherAlgoExecutionsPanel.tsx` et `useWeatherAlgoPositions`

**Objective:** Panneau positions (ouvertes avec bouton close) et panneau exécutions. CopiedPosition n'a pas de champ `traderAddress` — on filtre par `reason LIKE 'WEATHER_%'`. Execution n'a pas de `traderAddress` non plus — on filtre par `reason` aussi.

**Files:**
- Create: `packages/frontend/src/hooks/useWeatherAlgoPositions.ts`
- Create: `packages/frontend/src/components/WeatherAlgoPositionsPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoExecutionsPanel.tsx`

**`useWeatherAlgoPositions.ts`:**

```typescript
import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';

interface WeatherPosition {
  id: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  quantity: number;
  entryPrice: number;
  status: string;
  mode: string;
  unrealizedPnl: number;
  reason: string | null;
}

const POLL_MS = 10_000;

export function useWeatherAlgoPositions() {
  const [positions, setPositions] = createSignal<WeatherPosition[]>([]);
  const [loading, setLoading] = createSignal(true);

  async function refresh() {
    try {
      // CopiedPosition doesn't have traderAddress — filter by reason prefix.
      // Weather-algo positions have reason 'WEATHER_OPEN' or 'WEATHER_FORECAST_CHANGE'.
      const data = await api<WeatherPosition[]>('/copied-positions?status=open');
      setPositions(data.filter((p) =>
        p.reason != null && p.reason.startsWith('WEATHER_')
      ));
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function closePosition(id: number) {
    await api(`/copied-positions/${id}/close`, { method: 'POST' });
    await refresh();
  }

  onMount(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    onCleanup(() => clearInterval(poll));
  });

  return { positions, loading, closePosition, refresh };
}
```

**`WeatherAlgoPositionsPanel.tsx`:**

```typescript
import { For, Show } from 'solid-js';
import type { useWeatherAlgoPositions } from '../hooks/useWeatherAlgoPositions';

type PositionsState = ReturnType<typeof useWeatherAlgoPositions>;

export interface WeatherAlgoPositionsPanelProps {
  positions: PositionsState;
}

export function WeatherAlgoPositionsPanel(props: WeatherAlgoPositionsPanelProps) {
  const p = () => props.positions;
  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Positions weather-algo</h2>
        <span class="algo-panel-count">{p().positions().length} ouvertes</span>
      </div>
      <Show when={!p().loading()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={p().positions().length > 0} fallback={<div class="algo-empty">Aucune position ouverte.</div>}>
          <For each={p().positions()}>
            {(pos) => (
              <div class="weather-position-row">
                <span>{pos.outcome}</span>
                <span>Qté: {pos.quantity}</span>
                <span>Entrée: {pos.entryPrice}</span>
                <span>PnL: {pos.unrealizedPnl.toFixed(2)}</span>
                <button class="btn btn-sm btn-ghost" onClick={() => p().closePosition(pos.id)}>
                  Fermer
                </button>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </section>
  );
}
```

**`WeatherAlgoExecutionsPanel.tsx`:**

```typescript
import { For, Show, createSignal } from 'solid-js';
import { api } from '../api';

interface Execution {
  id: number;
  copiedPositionId: number;
  side: string;
  reason: string | null;
  status: string;
  mode: string;
  executedAt: string | null;
}

export function WeatherAlgoExecutionsPanel() {
  const [executions, setExecutions] = createSignal<Execution[]>([]);
  const [loading, setLoading] = createSignal(true);

  async function load() {
    try {
      const data = await api<{ items: Execution[]; total: number }>('/executions?limit=50');
      // Execution doesn't have traderAddress — filter by reason prefix.
      setExecutions(data.items.filter((e) =>
        e.reason != null && e.reason.startsWith('WEATHER_')
      ));
    } catch { /* ignore */ }
    setLoading(false);
  }

  void load();

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Exécutions</h2>
        <button class="btn btn-sm btn-ghost" onClick={() => load()}>Rafraîchir</button>
      </div>
      <Show when={!loading()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={executions().length > 0} fallback={<div class="algo-empty">Aucune exécution.</div>}>
          <div class="algo-exec-list">
            <For each={executions()}>
              {(ex) => (
                <div class="algo-exec-row">
                  <span>{ex.executedAt ? new Date(ex.executedAt).toLocaleString() : '—'}</span>
                  <span>{ex.side}</span>
                  <span>{ex.reason}</span>
                  <span>{ex.status}</span>
                  <span>{ex.mode}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}
```

---

### Task B.10: Refactoriser `WeatherAlgoPage.tsx` pour utiliser les sous-composants

**Files:**
- Modify: `packages/frontend/src/components/WeatherAlgoPage.tsx` (réécriture complète)

```typescript
import { createSignal, Show } from 'solid-js';
import { useWeatherAlgoDashboard } from '../hooks/useWeatherAlgoDashboard';
import { useWeatherAlgoPositions } from '../hooks/useWeatherAlgoPositions';
import { WeatherAlgoHeader } from './WeatherAlgoHeader';
import { WeatherAlgoDiscoverPanel } from './WeatherAlgoDiscoverPanel';
import { WeatherAlgoActiveMarketsPanel } from './WeatherAlgoActiveMarketsPanel';
import { WeatherAlgoForecastPanel } from './WeatherAlgoForecastPanel';
import { WeatherAlgoPositionsPanel } from './WeatherAlgoPositionsPanel';
import { WeatherAlgoExecutionsPanel } from './WeatherAlgoExecutionsPanel';
import { WeatherAlgoAutoTrackTab } from './WeatherAlgoAutoTrackTab';
import { WeatherAlgoSettingsTab } from './WeatherAlgoSettingsTab';

type Tab = 'markets' | 'positions' | 'autotrack' | 'settings';

export function WeatherAlgoPage() {
  const dashboard = useWeatherAlgoDashboard();
  const positions = useWeatherAlgoPositions();
  const [tab, setTab] = createSignal<Tab>('markets');

  return (
    <div class="weather-algo-page">
      <WeatherAlgoHeader status={dashboard.status()} />

      <div class="weather-algo-tabs">
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'markets', 'btn-ghost': tab() !== 'markets' }}
          onClick={() => setTab('markets')}>Marchés</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'positions', 'btn-ghost': tab() !== 'positions' }}
          onClick={() => setTab('positions')}>Positions</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'autotrack', 'btn-ghost': tab() !== 'autotrack' }}
          onClick={() => setTab('autotrack')}>Auto-track</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'settings', 'btn-ghost': tab() !== 'settings' }}
          onClick={() => setTab('settings')}>Paramètres</button>
      </div>

      <Show when={tab() === 'markets'}>
        <div class="weather-algo-grid">
          <WeatherAlgoActiveMarketsPanel
            selections={dashboard.selections()}
            onToggle={dashboard.toggleSelection}
            onRemove={dashboard.removeSelection}
          />
          <WeatherAlgoDiscoverPanel
            results={dashboard.discoverResults()}
            loading={dashboard.discoverLoading()}
            onRefresh={dashboard.discoverMarkets}
            onAdd={dashboard.addMarket}
          />
          <WeatherAlgoForecastPanel />
        </div>
      </Show>

      <Show when={tab() === 'positions'}>
        <WeatherAlgoPositionsPanel positions={positions} />
        <WeatherAlgoExecutionsPanel />
      </Show>

      <Show when={tab() === 'autotrack'}>
        <WeatherAlgoAutoTrackTab
          rules={dashboard.autoTrackRules()}
          onAdd={dashboard.addAutoTrackRule}
          onRemove={dashboard.removeAutoTrackRule}
          onToggle={dashboard.toggleAutoTrackRule}
        />
      </Show>

      <Show when={tab() === 'settings'}>
        <WeatherAlgoSettingsTab />
      </Show>
    </div>
  );
}
```

**Build:**

Run: `npm run build -w @polywatch/frontend`
Expected: PASS

---

## Phase C — Documentation & Validation

### Task C.1: Documenter les routes weather-algo dans `docs/api.md`

**Files:**
- Modify: `docs/api.md` (append à la fin du fichier)

```markdown
## Weather Algo

Routes pour le trading algorithmique météo (weather-algo). Toutes requièrent un JWT.

### Sélections de marchés

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-markets` | Liste toutes les sélections |
| POST | `/api/weather-algo-markets` | Ajoute `{conditionId, question?, eventSlug?, city?, targetDate?, metric?, targetValue?}` |
| DELETE | `/api/weather-algo-markets/:conditionId` | Supprime (204) |
| PATCH | `/api/weather-algo-markets/:conditionId` | Active/désactive `{enabled: boolean}` |
| GET | `/api/weather-algo-markets/status` | Statut runtime (heartbeat Redis + counts) |
| POST | `/api/weather-algo-markets/notify-changed` | Interne — notifie un changement (sans JWT) |

### Découverte

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-discover?limit=50&offset=0` | Découvre les marchés météo Polymarket (`tag_slug=weather`) → `{temperatureMarkets, allWeatherMarkets}` |

### Prévisions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-forecasts/:city/:date?metric=highest_temp` | Prévision météo (cache DB → fallback Open-Meteo) |

### Auto-track

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-auto-track` | Liste les règles |
| POST | `/api/weather-algo-auto-track` | Ajoute `{city, metric, lookAheadDays?}` |
| DELETE | `/api/weather-algo-auto-track/:id` | Supprime (204) |
| PATCH | `/api/weather-algo-auto-track/:id` | Active/désactive `{enabled: boolean}` |
```

---

### Task C.2: Documenter le package weather-algo dans `docs/architecture.md`

**Files:**
- Modify: `docs/architecture.md`

Dans le diagramme ASCII, ajouter `weather-algo` et dans le tableau des packages ajouter la ligne correspondante. Ajouter une section après crypto-algo décrivant le processus weather-algo.

---

### Task C.3: Créer `change.history.md`

**Files:**
- Create: `change.history.md` (à la racine du projet)

---

### Task C.4: Validation finale

**Step 1: Build tous les packages**

Run: `npm run build`
Expected: PASS

**Step 2: Tests**

Run: `npm run test`
Expected: PASS

**Step 3: Vérification manuelle frontend**

1. Ouvrir `http://localhost:5173` → Weather Algo
2. Vérifier que les marchés °F ont le bouton "+ Suivre" (parsed = true)
3. Ajouter un marché → il apparaît dans "Marchés suivis"
4. Onglet Auto-track → ajouter une règle
5. Onglet Paramètres → sauvegarder des champs weather

---

## Ordre d'exécution et dépendances

```
A.1 (parser) → A.2 (computeMarketImpliedProbabilities) → A.3 (consumers) → A.4 (frontend parser)
B.1 (schema zod) → indépendant
B.2-B.9 (composants) → dépend de A.4 pour DiscoverPanel
B.10 (refactor page) → dépend de B.2-B.9
C.1-C.3 (docs) → dépend de A et B
C.4 (validation) → dépend de tout
```