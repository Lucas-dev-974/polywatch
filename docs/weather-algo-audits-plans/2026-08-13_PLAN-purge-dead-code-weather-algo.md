# Plan — Partie 2 : Purge de l'inventaire dead code (D1–D12)

- **Date** : 2026-08-13
- **Statut** : ✅ implémenté (2026-08-13)
- **Scope** : `packages/backtest`, `packages/core`, `packages/frontend`, `packages/weather-algo`
- **Référence** : [`2026-08-11_audit-weather-algo-complet.md`](./2026-08-11_audit-weather-algo-complet.md) (§2 « Inventaire dead code », D1–D12)

**Objectif** : Purger le dead code identifié à l'audit weather-algo (partie 2). L'inventaire D1–D12 a été **re-vérifié par lecture directe du code au 2026-08-13** ; les éléments réfutés (D7, D13) et les éléments à conserver (D12, partie de D11) sont explicitement sortis du périmètre de suppression ou re-scopés.

> ⚠️ **Périmètre volontairement restreint** : ce plan ne traite **que** le dead code (§2 de l'audit). Les risques techniques (T1–T7, §3) et les refactors (R1–R10, §4) restent hors scope et feront l'objet de plans dédiés.

---

## 1. Contexte et re-vérification

L'inventaire §2 listait 13 éléments (D1–D13). Vérification au 2026-08-13 par lecture du code :

| # | Élément | Verdict audit | Re-vérification 2026-08-13 | Décision |
|---|---------|---------------|----------------------------|----------|
| **D1** | `WeatherCityGroup.tsx` | Supprimer | ✅ Aucun importeur (grep : uniquement docs, `change.history.md`, plans `.hermes`) | **Supprimer** |
| **D2** | `lib/weather-grouping.ts` + `groupByCity` | Supprimer | ✅ Aucun importeur | **Supprimer** |
| **D3** | `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage` | Supprimer | ✅ Déclaré dans `api.ts:645,811-812`, **aucun appelant** frontend. ⚠️ La route backend `/coverage` (route `weather-algo-data.ts:192`) **existe** — seule la couche frontend est morte | **Supprimer côté frontend uniquement** |
| **D4** | `ClockedWeatherForecastStrategy` (deprecated) | Supprimer | ✅ `clocked-weather-strategy.ts:70-74`, aucun importeur | **Supprimer** |
| **D5** | `createWeatherAdapter` export | Supprimer | ✅ `backtest/src/index.ts:75-77`, aucun consommateur | **Supprimer** |
| **D6** | `WeatherReconstructedMarket` interface | Supprimer | ✅ `context-builder.ts:6-13`, inutilisée | **Supprimer** |
| **D7** | `WeatherRuntimeStatus` | Réfuté | ✅ Interface **utilisée** (lecture lignes 57, 60) | **Conserver** |
| **D8** | Variant `timer` dans `BacktestEvent` | Supprimer (union) | ✅ `events.ts:62` déclaré mais **jamais produit** (`data-loader.ts` ne produit que `forecast`/`book_tick`/`signal` ligne 186/258/334) **ni consommé** (`weather-adapter.ts` switch sur `forecast`/`book_tick`/`signal` lignes 266-272) | **Supprimer (union)** |
| **D9** | `formatDate` no-op dans question-builder | Inliner / supprimer | ✅ `question-builder.ts:10-14` retourne l'input tel quel, 1 seul call site (ligne 38) | **Inliner** |
| **D10** | `DEFAULT_STRATEGIES_JSON` / `DEFAULT_PARAMS_JSON` | Supprimer | ✅ `strategy-catalog.ts:227-228,366` exports, **aucun import** | **Supprimer** |
| **D11** | Routes legacy (`POST /` no-op, `syncMarketSelectionsForAutoTrack` no-op) | Supprimer `POST /` + `syncMarketSelectionsForAutoTrack` ; conserver/réimplémenter `DELETE`/`PATCH` | ⚠️ **Nuance** : `DELETE /:conditionId` et `PATCH /:conditionId` émettent des side-effects event-bus mais **aucun consommateur** frontend (seul `/status` est appelé, `useWeatherAlgoDashboard.ts:80`). `syncMarketSelectionsForAutoTrack` est appelé par le janitor weather-algo (`index.ts:176`, via `auto-track-janitor.ts`) mais **retourne un no-op** `{disabled:0, added:0}` | **Supprimer `POST /`, `DELETE`, `PATCH` + no-op du service + type `WeatherAutoTrackSyncResult` + cycle janitor complet** (timer + shutdown inclus, voir §4.4) |
| **D12** | Champs `WeatherConfig` non lus (~30 legacy) | Documenter / nettoyer | ⚠️ `WeatherConfig` est **utilisé massivement** (5 composants + hooks + `api.ts`). Le constat « champs non lus » n'est **pas vérifié champ par champ** | **Hors périmètre de suppression** — documenter uniquement (§4.5) |
| **D13** | Fichiers `node_modules` | Réfuté | ✅ Non trackés par git | **N/A** |

**Résultat** : **8 suppressions réelles** (D1, D2, D3-frontend, D4, D5, D6, D8, D10), **1 inline** (D9), **1 suppression scopée** (D11), **2 conserver/documenter** (D7, D12), **1 réfuté** (D13).

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| **D3-scope** | Ne supprimer **que** `fetchWeatherAlgoDataCoverage` + interface `WeatherAlgoDataCoverage` côté frontend | La route backend `/coverage` est potentiellement consommée par d'autres outils (ex. `weather-algo-data.service.ts:942` produit le coverage). Supprimer la route serait un changement de contrat API hors périmètre dead code frontend. Le DTO reste disponible via le service backend. |
| **D5-scope** | Retirer `createWeatherAdapter` **uniquement de l'export** de `backtest/src/index.ts` | Vérifier que la fonction n'est pas ré-exportée/consommée ailleurs (grep : seul `index.ts`). Si la fonction est aussi définie/exportée localement, ne pas toucher la définition tant qu'elle n'a pas d'appelant — supprimer l'export mort. |
| **D8-union** | Retirer `| { kind: 'timer'; at: Date; tag: string }` de l'union `BacktestEvent` | `data-loader` ne le produit pas et `weather-adapter` ne le switch pas. Après retrait, re-vérifier compil (les `switch` exhaustifs existants restent valides car aucun cas `timer`). ⚠️ **Note** : `events.ts` est un fichier **non tracké** (nouveau, cf. `git status`) — s'assurer que l'édition est cohérente avec le code tracké. |
| **D9-inline** | Remplacer l'appel `formatDate(input.targetDateIso)` par `input.targetDateIso` et supprimer la fonction | La fonction est un no-op documenté (`// targetDateIso ... parses fine`). Le commentaire explicatif peut être conservé au point d'appel si utile. |
| **D10-exports** | Supprimer `DEFAULT_STRATEGIES_JSON`/`DEFAULT_PARAMS_JSON` (constantes + export ligne 366) | Aucun import (grep exhaustif). Vérifier qu'aucun test ne les référence. |
| **D11-janitor** | Supprimer la no-op `syncMarketSelectionsForAutoTrack` **et** le type `WeatherAutoTrackSyncResult` (weather-only) + tout le cycle janitor (`runWeatherAutoTrackJanitorCycle`, `runAutoTrackTick`, `autoTrackTimer`, appel initial, `clearInterval` shutdown) | La méthode retourne `{disabled:0, added:0}` (no-op), le janitor n'a plus de raison d'exister. ⚠️ **Nettoyage complet obligatoire** : sans retirer `runAutoTrackTick` + `autoTrackTimer` + `clearInterval(autoTrackTimer)` dans `index.ts`, le module ne compile plus. Le type `WeatherAutoTrackSyncResult` est weather-only (aucun import) → supprimer avec la méthode. Impact : `packages/weather-algo/src/index.ts` + `auto-track-janitor.ts` + `weather-auto-track.service.ts`. |
| **D11-routes** | Supprimer `POST /`, `DELETE /:conditionId`, `PATCH /:conditionId` **et** `POST /notify-changed` du routeur `weather-algo-markets.ts` | Aucun consommateur frontend (seul `/status` est appelé par `useWeatherAlgoDashboard.ts:80`). La route `/notify-changed` (lignes 81-85) est aussi **morte** : le service weather-algo ne l'appelle jamais (contrairement à la version crypto-algo qui appelle `/api/algo/markets/notify-changed` — `crypto-algo/src/index.ts:322`). Le signal de changement de config weather n'est pas perdu : `publishConfigChanged`/`emitAlgoMarketsChanged` sont aussi déclenchés par la route active `weather-algo-auto-track.ts:53-54,65-66,91-92`. **Conserver** uniquement `GET /` (22-25) et `GET /status` (27-79). |
| **D12-doc** | Ne **pas** supprimer de champs `WeatherConfig` | Le cross-check champ par champ n'a pas été fait. Documenter en §4.5 les champs à vérifier (audit ultérieur), sans suppression. |

---

## 3. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `packages/frontend/src/components/WeatherCityGroup.tsx` | **Supprimer le fichier** | D1 |
| `packages/frontend/src/lib/weather-grouping.ts` | **Supprimer le fichier** | D2 |
| `packages/frontend/src/api.ts` | Supprimer `fetchWeatherAlgoDataCoverage` (811-812) + interface `WeatherAlgoDataCoverage` (645-653) | D3 |
| `packages/backtest/src/adapters/weather/clocked-weather-strategy.ts` | Supprimer `ClockedWeatherForecastStrategy` (70-74) | D4 |
| `packages/backtest/src/index.ts` | Retirer l'export `createWeatherAdapter` (75-77) | D5 |
| `packages/backtest/src/adapters/weather/context-builder.ts` | Supprimer l'interface `WeatherReconstructedMarket` (6-13) | D6 |
| `packages/backtest/src/engine/events.ts` | Retirer le variant `timer` de l'union `BacktestEvent` (62) | D8 |
| `packages/backtest/src/adapters/weather/question-builder.ts` | Inliner `formatDate` (10-14, 38) | D9 |
| `packages/core/src/weather/strategy-catalog.ts` | Supprimer `DEFAULT_STRATEGIES_JSON`/`DEFAULT_PARAMS_JSON` (227-228, 366) | D10 |
| `packages/backend/src/routes/weather-algo-markets.ts` | Supprimer `POST /notify-changed`, `POST /`, `DELETE /:conditionId`, `PATCH /:conditionId` + imports `publishConfigChanged`/`emitAlgoMarketsChanged` (`getRedis` conservé) | D11 |
| `packages/core/src/services/weather-auto-track.service.ts` | Supprimer la no-op `syncMarketSelectionsForAutoTrack` (85-87) **et** le type `WeatherAutoTrackSyncResult` (8-11) | D11 |
| `packages/weather-algo/src/auto-track-janitor.ts` | Supprimer `runWeatherAutoTrackJanitorCycle` (fichier entier) | D11 |
| `packages/weather-algo/src/index.ts` | Retirer import (38), `runAutoTrackTick` (174-188), `autoTrackTimer` (216-220), `void runAutoTrackTick()` (221), `clearInterval(autoTrackTimer)` (287) | D11 |

> **Méthode homonyme** : `syncMarketSelectionsForAutoTrack` existe en version crypto (`AlgoAutoTrackService.syncMarketSelectionsForAutoTrack`, `algo-auto-track.service.ts:315`) avec une signature **différente** (`Promise<{ disabled; disabledIds; added }>` + param `selectionService`) et active (appelée par `crypto-algo/src/auto-track-janitor.ts:23`). Ne supprimer **que** la méthode du service weather (D11).
>
> ⚠️ **Type `WeatherAutoTrackSyncResult`** : contrairement à la méthode, ce type n'est **pas** un homonyme — il est défini **uniquement** dans `weather-auto-track.service.ts:8` (grep `import.*WeatherAutoTrackSyncResult` → 0 résultat). Son seul usager est la méthode no-op supprimée → le supprimer dans la même opération.
>
> ⚠️ **Janitor weather complet** : la suppression de `runWeatherAutoTrackJanitorCycle` entraîne la mort de `runAutoTrackTick` (174-188), du timer `autoTrackTimer` (216-220), de l'appel initial `void runAutoTrackTick()` (221) et du `clearInterval(autoTrackTimer)` au shutdown (287) dans `index.ts`. Tous doivent être retirés ensemble, sinon `index.ts` ne compile plus (référence à une fonction supprimée).

---

## 4. Détail des changements

### 4.1 D1 / D2 — Suppression de composants/libs frontend orphelins

Supprimer les fichiers :
- `packages/frontend/src/components/WeatherCityGroup.tsx`
- `packages/frontend/src/lib/weather-grouping.ts`

Aucun importeur (re-vérifié). Vérifier après suppression que `npm run build -w @polywatch/frontend` compile (aucun dangling import).

> ⚠️ `WeatherCityGroup` est référencé dans `docs/frontend.md` et `docs/code/06-frontend.md` et `change.history.md` (historique). Mettre à jour les docs **si elles listent le composant comme livré** (voir §7, F-doc). `change.history.md` est un journal, on ne le réécrit pas.

### 4.2 D3 — `fetchWeatherAlgoDataCoverage` / `WeatherAlgoDataCoverage` (frontend only)

Dans `packages/frontend/src/api.ts` :
- Supprimer l'interface `WeatherAlgoDataCoverage` (lignes 645-653).
- Supprimer la fonction `fetchWeatherAlgoDataCoverage` (lignes 811-812).

```typescript
// AVANT
export interface WeatherAlgoDataCoverage {
  from: string | null;
  to: string | null;
  cities: string[];
  totalSnapshots: number;
  totalEvaluations: number;
  totalForecastHistory: number;
  totalBucketTicks: number;
}
// ...
export async function fetchWeatherAlgoDataCoverage(): Promise<WeatherAlgoDataCoverage> {
  return api<WeatherAlgoDataCoverage>('/weather-algo-data/coverage');
}
```

> La route backend `/coverage` et le type core `WeatherAlgoDataCoverage` (`weather-algo-data.service.ts:942`) restent **intacts** — ils ne sont pas du dead code frontend.

### 4.3 D4 / D5 / D6 / D8 / D9 / D10 — Backtest + core

**D4** — `clocked-weather-strategy.ts` : supprimer la classe deprecated :

```typescript
/** @deprecated Use createWeatherStrategy + ClockedWeatherStrategy */
export class ClockedWeatherForecastStrategy extends ClockedWeatherStrategy {
  constructor() {
    super(new WeatherForecastStrategy());
  }
}
```

**D5** — `backtest/src/index.ts` : retirer l'export :

```typescript
export function createWeatherAdapter(ctx: RunContext): WeatherBacktestAdapter {
```

**D6** — `context-builder.ts` : supprimer l'interface :

```typescript
/** A reconstructed market + current forecast revision for re-evaluation. */
export interface WeatherReconstructedMarket {
  market: MarketListItemDto;
  city: string;
  targetDateIso: string;
  metric: string;
}
```

**D8** — `engine/events.ts` : retirer le variant de l'union :

```typescript
export type BacktestEvent =
  | { kind: 'book_tick'; at: Date; data: BookTickEventData }
  | { kind: 'forecast'; at: Date; data: ForecastRevisionData }
  | { kind: 'signal'; at: Date; data: SignalEventData };
```

**D9** — `question-builder.ts` : inliner (supprimer la fonction ligne 10-14, remplacer ligne 38) :

```typescript
// AVANT
function formatDate(dateIso: string): string {
  return dateIso;
}
// ...
const date = formatDate(input.targetDateIso);
// APRÈS
const date = input.targetDateIso;
```

**D10** — `strategy-catalog.ts` : supprimer les deux constantes et leur export :

```typescript
const DEFAULT_STRATEGIES_JSON = JSON.stringify([WEATHER_FORECAST_STRATEGY_ID]);
const DEFAULT_PARAMS_JSON = '{}';
// ...
export { DEFAULT_STRATEGIES_JSON, DEFAULT_PARAMS_JSON };
```

### 4.4 D11 — Routes legacy + no-op service + janitor

**`weather-algo-markets.ts`** : supprimer les **4 routes mortes** (`POST /notify-changed` lignes 81-85, `POST /` lignes 88-94, `DELETE /:conditionId` lignes 96-101, `PATCH /:conditionId` lignes 103-108). Conserver uniquement `GET /` (22-25) et `GET /status` (27-79).

> ⚠️ **`POST /notify-changed` est aussi mort** : vérifié — le service weather-algo ne l'appelle jamais (contrairement à la version crypto-algo, `crypto-algo/src/index.ts:322`). Le signal de changement de config n'est pas perdu : `publishConfigChanged`/`emitAlgoMarketsChanged` sont aussi déclenchés par la route active `weather-algo-auto-track.ts` (lignes 53-54, 65-66, 91-92). Après suppression des 4 routes, les imports `publishConfigChanged` et `emitAlgoMarketsChanged` deviennent inutilisés dans ce fichier → les retirer de l'import (ligne 6 pour `publishConfigChanged`, ligne 7 pour `emitAlgoMarketsChanged`). **`getRedis` reste** (utilisé par `GET /status` ligne 33).

**`weather-auto-track.service.ts`** (service **weather**, pas crypto) : supprimer la no-op (85-87) **et** le type `WeatherAutoTrackSyncResult` (8-11) qui n'a plus d'usager :

```typescript
export type WeatherAutoTrackSyncResult = {
  disabled: number;
  added: number;
};
// ...
/**
 * City-first: legacy per-market selections have been removed.
 * This is a no-op kept for backward compatibility with the janitor cycle.
 */
async syncMarketSelectionsForAutoTrack(): Promise<WeatherAutoTrackSyncResult> {
  return { disabled: 0, added: 0 };
}
```

> ⚠️ **Ne pas confondre avec la version crypto** : `AlgoAutoTrackService.syncMarketSelectionsForAutoTrack` (`algo-auto-track.service.ts:315`) est une méthode **différente** (signature avec `selectionService`, retour `{ disabled; disabledIds; added }`), active, appelée par `crypto-algo/src/auto-track-janitor.ts:23`. **Conserver**. Le type `WeatherAutoTrackSyncResult` est en revanche **spécifique au service weather** (aucun import nulle part) — le supprimer en même temps que la méthode.

**`weather-algo/src/auto-track-janitor.ts`** : supprimer le fichier (seul `runWeatherAutoTrackJanitorCycle` y vit).

**`weather-algo/src/index.ts`** : retirer **l'ensemble du cycle janitor**, pas seulement l'appel (sinon `index.ts` ne compile plus) :
- import (ligne 38) : `import { runWeatherAutoTrackJanitorCycle } from './auto-track-janitor.js';`
- fonction `runAutoTrackTick` (lignes 174-188) — wrapper qui appelle le janitor et publie sur Redis si `added > 0`
- timer `autoTrackTimer` (lignes 216-220) : `safeInterval(() => runAutoTrackTick(), config.pollMs, 'weather-algo:auto-track-janitor')`
- appel initial (ligne 221) : `void runAutoTrackTick();`
- nettoyage shutdown (ligne 287) : `clearInterval(autoTrackTimer);`

```typescript
// À supprimer (174-188) :
const runAutoTrackTick = async (): Promise<void> => {
  try {
    const { added } = await runWeatherAutoTrackJanitorCycle(autoTrackService);
    if (added > 0) {
      await redisPub.publish(CONFIG_CHANGED_CHANNEL, JSON.stringify({ at: Date.now(), source: 'weather-algo-auto-track' }));
    }
  } catch (err) {
    log.error({ err }, 'weather auto-track janitor failed');
  }
};
// À supprimer (216-221) :
const autoTrackTimer = safeInterval(() => runAutoTrackTick(), config.pollMs, 'weather-algo:auto-track-janitor');
void runAutoTrackTick();
// À supprimer au shutdown (287) :
clearInterval(autoTrackTimer);
```

> ⚠️ Le janitor weather étant un no-op (`{disabled:0, added:0}`), `added` est toujours `0` → la publication Redis (ligne 180-183) n'était **jamais déclenchée**. La suppression ne perd donc aucune fonctionnalité observable. Vérifier que `autoTrackService` (créé ligne 61) n'a pas d'autre usage dans `index.ts` après retrait — si oui, retirer aussi sa création.

### 4.5 D12 — Documenter (hors suppression)

`WeatherConfig` est massivement consommé (`WeatherAlgoSettingsTab.tsx`, `WeatherAlgoStrategiesTab.tsx`, `WeatherAlgoDataTab.tsx:302`, `useWeatherAlgoDashboard.ts`, `simulation.ts`, `NewSessionResetDialog.tsx`). Le constat « ~30 champs legacy non lus » n'étant pas vérifié champ par champ, **aucune suppression n'est faite**. Action : créer une checklist d'audit (post-plan) croisant chaque champ de `WeatherConfig` (lignes 578-625) avec ses lectures dans le frontend, puis nettoyer dans un plan dédié.

---

## 5. Ordre d'implémentation

### Phase 1 — Frontend (D1, D2, D3)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 1 | Supprimer `WeatherCityGroup.tsx` | frontend | 1 min |
| 2 | Supprimer `weather-grouping.ts` | frontend | 1 min |
| 3 | Retirer `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage` | `api.ts` | 5 min |
| 4 | Build frontend (vérifier aucun dangling import) | `npm run build -w @polywatch/frontend` | 5 min |

### Phase 2 — Backtest (D4, D5, D6, D8, D9)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 5 | Supprimer `ClockedWeatherForecastStrategy` | `clocked-weather-strategy.ts` | 2 min |
| 6 | Retirer export `createWeatherAdapter` | `backtest/src/index.ts` | 2 min |
| 7 | Supprimer interface `WeatherReconstructedMarket` | `context-builder.ts` | 2 min |
| 8 | Retirer variant `timer` de `BacktestEvent` | `engine/events.ts` | 2 min |
| 9 | Inliner `formatDate` | `question-builder.ts` | 2 min |
| 10 | Build backtest + tests | `npm run build -w @polywatch/backtest && npm run test -w @polywatch/backtest` | 5 min |

### Phase 3 — Core (D10) + routes/service/janitor (D11)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 11 | Supprimer `DEFAULT_STRATEGIES_JSON`/`DEFAULT_PARAMS_JSON` | `strategy-catalog.ts` | 2 min |
| 12 | Supprimer `POST /`, `DELETE`, `PATCH` legacy | `weather-algo-markets.ts` | 5 min |
| 13 | Supprimer no-op `syncMarketSelectionsForAutoTrack` | `weather-auto-track.service.ts` | 2 min |
| 14 | Supprimer `auto-track-janitor.ts` + appel `index.ts` | `packages/weather-algo` | 5 min |
| 15 | Build core + backend + weather-algo + tests | — | 8 min |

### Phase 4 — Validation croisée

| # | Tâche | Effort |
|---|-------|--------|
| 16 | Grep exhaustif des symboles supprimés (aucun import restant) | 5 min |
| 17 | ReadLints sur tous les fichiers modifiés | 3 min |
| 18 | Build workspace complet (`npm run build`) | 8 min |

**Effort total estimé** : ~1h15

---

## 6. Tests

| Composant | Vérification | Constat |
|-----------|--------------|---------|
| Frontend build | Compile sans `WeatherCityGroup`/`groupByCity`/`fetchWeatherAlgoDataCoverage` | D1/D2/D3 |
| Backtest build + tests | Compile sans `timer` variant, `ClockedWeatherForecastStrategy`, `createWeatherAdapter`, `WeatherReconstructedMarket`, `formatDate` | D4/D5/D6/D8/D9 |
| Core build + tests | Compile sans `DEFAULT_*_JSON` ; aucun test ne les référence | D10 |
| Backend build | Route `weather-algo-markets` compile sans les 4 routes legacy (`POST /notify-changed`, `POST /`, `DELETE`, `PATCH`) ; imports `publishConfigChanged`/`emitAlgoMarketsChanged` retirés | D11 |
| weather-algo build | `index.ts` compile sans le janitor | D11 |
| Grep final | `rg "WeatherCityGroup\|groupByCity\|fetchWeatherAlgoDataCoverage\|ClockedWeatherForecastStrategy\|createWeatherAdapter\|WeatherReconstructedMarket\|DEFAULT_STRATEGIES_JSON\|DEFAULT_PARAMS_JSON\|runWeatherAutoTrackJanitorCycle\|runAutoTrackTick\|autoTrackTimer\|WeatherAutoTrackSyncResult"` → aucun résultat dans `packages/` | Tous |

> Les tests existants (backtest 28/28, weather-algo, core) doivent rester verts — aucune de ces suppressions ne touche une branche exercée par un test (tous les éléments supprimés sont sans appelant). Re-vérifier que `weather-auto-track.service.test.ts` (s'il existe) ne référence pas la no-op supprimée.

---

## 7. Risques résiduels & impacts docs

| Risque / impact | Mitigation |
|-----------------|------------|
| **D11** : supprimer le janitor weather-algo pourrait laisser un cycle « de désactivation des règles » non traité. | Le no-op retournait `{disabled:0, added:0}` : il ne faisait **rien** (la logique city-first de désactivation est ailleurs). Aucune fonctionnalité perdue. Vérifier que `weather-algo/src/index.ts` n'a pas d'autre utilisation du retour du janitor. |
| **D11 homonyme (méthode)** : `syncMarketSelectionsForAutoTrack` existe en version crypto (`AlgoAutoTrackService`, `algo-auto-track.service.ts:315`, signature différente, active). | Ne supprimer **que** la méthode du service weather. Ne pas toucher au janitor crypto (`crypto-algo/src/auto-track-janitor.ts:23`). Le **type** `WeatherAutoTrackSyncResult` n'est pas un homonyme (weather-only) → supprimer avec la méthode weather. |
| **D11 compile** : retirer `runAutoTrackTick`/`autoTrackTimer`/`clearInterval` dans `index.ts`. | Nettoyage complet du cycle — sans cela, `index.ts` référence une fonction supprimée et ne compile plus. `autoTrackService` (ligne 61) reste utilisé ailleurs (ligne 159) → **ne pas** supprimer sa création. |
| **D8** : `events.ts` est présent sur disque mais **non tracké** par git (`?? packages/backtest/src/engine/events.ts`). | L'union `timer` n'est ni produite ni consommée ; le retrait est sûr. Éditer le fichier in-place puis `git add` (ne pas le réécrire — les 3 variants valides `book_tick`/`forecast`/`signal` doivent être conservés). |
| **D5** : `createWeatherAdapter` pourrait être importé via un chemin `@polywatch/backtest`. | Grep exhaustif : aucun import. Après retrait, re-vérifier `rg "createWeatherAdapter"` dans tout le repo. |
| **D3** : supprimer le DTO frontend alors que la route backend existe. | Volontaire : la route reste (contrat API backend). Si un futur besoin de coverage frontend apparaît, il suffira de recréer la fonction. |
| **Docs** : `docs/frontend.md`, `docs/code/06-frontend.md` listent peut-être `WeatherCityGroup`. | Vérifier et retirer la mention du composant supprimé (D1). `change.history.md` est un journal — ne pas réécrire. |
| **D12** : ne pas supprimer les champs legacy. | Checklist d'audit champ-par-champ (post-plan) avant toute suppression future. |

---

## 8. Checklist prod

- [ ] `npm run build` (workspace complet) — passe sans erreur
- [ ] `npm test` + `npm run test -w @polywatch/backtest` — aucun nouveau échec (les échecs pré-existants hors périmètre restent ; ⚠️ `npm test` racine n'inclut pas le backtest)
- [ ] ReadLints — aucun nouveau lint error sur les fichiers modifiés
- [ ] `rg` des symboles supprimés → aucun résultat dans `packages/`
- [ ] Les 4 routes legacy (`POST /notify-changed`, `POST /`, `DELETE /:conditionId`, `PATCH /:conditionId`) absentes de `weather-algo-markets.ts` ; `GET /`, `GET /status` conservées ; imports `publishConfigChanged`/`emitAlgoMarketsChanged` retirés (`getRedis` conservé)
- [ ] Le janitor weather (pas crypto) supprimé ; `weather-auto-track.service.ts` (weather) sans no-op ; `algo-auto-track.service.ts` (crypto) intact
- [ ] `git diff --stat` — périmètre limité aux fichiers listés §3
- [ ] Docs frontend mises à jour (retrait mention `WeatherCityGroup` si présente)

---

## 9. Critère de complétude

- [x] D1 : `WeatherCityGroup.tsx` supprimé, aucun import restant
- [x] D2 : `weather-grouping.ts` + `groupByCity` supprimés, aucun import restant
- [x] D3 : `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage` retirés de `api.ts` ; route backend `/coverage` **intacte**
- [x] D4 : `ClockedWeatherForecastStrategy` supprimé
- [x] D5 : export `createWeatherAdapter` retiré de `backtest/src/index.ts` (+ import `RunContext` inutilisé retiré)
- [x] D6 : interface `WeatherReconstructedMarket` supprimée
- [x] D7 : `WeatherRuntimeStatus` conservé (réfuté)
- [x] D8 : variant `timer` retiré de l'union `BacktestEvent`
- [x] D9 : `formatDate` inliné (plus de fonction no-op)
- [x] D10 : `DEFAULT_STRATEGIES_JSON`/`DEFAULT_PARAMS_JSON` supprimés (+ export)
- [x] D11 : `POST /notify-changed`, `POST /`, `DELETE /:conditionId`, `PATCH /:conditionId` supprimés ; imports `publishConfigChanged`/`emitAlgoMarketsChanged` retirés (`getRedis` conservé) ; no-op service weather + type `WeatherAutoTrackSyncResult` supprimés (+ import `pino`/`log` inutilisé retiré) ; cycle janitor weather complet retiré (`runWeatherAutoTrackJanitorCycle`, `runAutoTrackTick`, `autoTrackTimer`, appel initial, `clearInterval` shutdown) ; crypto intact ; `autoTrackService` conservé (utilisé ligne 159) ; `CONFIG_CHANGED_CHANNEL`/`redisPub` conservés (utilisés ailleurs)
- [x] D12 : aucun champ `WeatherConfig` supprimé — checklist d'audit documentée en §4.5
- [x] D13 : aucune action (réfuté)
- [x] Builds frontend / backtest / core / backend / weather-algo + tests + lints passent
- [x] Aucun fichier hors périmètre modifié

---

## 10. Suivi d'implémentation (2026-08-13)

Le plan a été implémenté intégralement le 2026-08-13. Cette section documente les écarts mineurs par rapport au plan initial, la validation, et les nettoyages additionnels hors-plan.

### Écarts et nettoyages additionnels (hors-plan)

- **D5** — en plus de l'export `createWeatherAdapter`, l'import `RunContext` est devenu inutilisé dans `backtest/src/index.ts` → retiré de l'import `BacktestRunner, type RunResult, type RunContext` (lint `no-unused-vars`).
- **D11 (service)** — en plus du type `WeatherAutoTrackSyncResult` et de la méthode no-op, l'import `pino` et la déclaration `const log = pino(...)` sont devenus inutilisés dans `weather-auto-track.service.ts` → retirés (lint `no-unused-vars`).
- **D11 (routes)** — en plus des imports `publishConfigChanged`/`emitAlgoMarketsChanged`, l'import `requireServiceToken` est devenu inutilisé dans `weather-algo-markets.ts` (son seul usage était `POST /notify-changed`) → retiré de l'import `requireJwt, requireServiceToken`.

Ces 3 nettoyages supplémentaires sont la conséquence directe des suppressions prévues au plan (imports devenus orphelins après suppression de leur unique consommateur). Ils n'étendent pas le périmètre fonctionnel — ce sont des nettoyages de lint mécaniquement requis.

### Validation post-implémentation

- **Build workspace complet** (`npm run build`) : ✅ OK — les 8 packages compilent (core, backend, worker, copy-trading, crypto-algo, weather-algo, backtest, frontend).
- **Tests** :
  - backtest : **28/28** ✅
  - weather-algo : **60/60** ✅
  - frontend : **142/142** ✅
  - core : **769/774** — 5 échecs **pré-existants** (hors périmètre, confirmés par l'audit §10 : `market-metadata` ×2, `policy` trailing, `snapshot-decision-collector-parity`, `resume-reserved-entry`). Aucune régression introduite.
- **Lints** : 0 erreur, 0 warning sur les fichiers modifiés. Les 36 warnings frontend restants sont pré-existants dans d'autres fichiers (hors périmètre).
- **Grep final** : `rg "WeatherCityGroup|groupByCity|fetchWeatherAlgoDataCoverage|ClockedWeatherForecastStrategy|createWeatherAdapter|WeatherReconstructedMarket|DEFAULT_STRATEGIES_JSON|DEFAULT_PARAMS_JSON|runWeatherAutoTrackJanitorCycle|runAutoTrackTick|autoTrackTimer|WeatherAutoTrackSyncResult"` → aucun résultat dans `packages/`.
- **Périmètre** : 16 fichiers modifiés (10 modifiés + 3 supprimés + 3 docs), 247 suppressions, 9 insertions. Conforme à la §3 du plan.

### Reste à faire en prod

- Aucune migration nécessaire (aucun changement de schéma).
- `events.ts` est un fichier non tracké (nouveau) — inclure dans le commit.
- Smoke test : `GET /weather-algo-markets/status` répond toujours (route conservée) ; `POST /weather-algo-markets/notify-changed` retourne 404 (route supprimée — attendu, aucun consommateur ne l'appelait).
