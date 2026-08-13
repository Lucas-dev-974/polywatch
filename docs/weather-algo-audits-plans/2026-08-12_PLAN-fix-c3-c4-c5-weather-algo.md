# Plan — Fix C3 (table ids dupliqués) + C4 (restrictions `metric`) + C5 (`parseExitReason` hardcodé)

- **Date** : 2026-08-12
- **Statut** : implémenté (vérifié 2026-08-12)
- **Scope** : `packages/core`, `packages/backend`, `packages/weather-algo`, `packages/frontend`
- **Référence** : [`2026-08-11_audit-weather-algo-complet.md`](./2026-08-11_audit-weather-algo-complet.md) · [`2026-08-12_PLAN-fix-c1-c2-weather-algo.md`](./2026-08-12_PLAN-fix-c1-c2-weather-algo.md)

**Objectif** : Corriger trois constats 🟠 Haute de l'audit weather-algo. C3 est une duplication d'une liste d'identifiants de tables entre la route et le service (drift à chaque nouvelle table). C4 est un ensemble de restrictions `metric` inconsistantes entre le parser, le service, les routes, le strategy et les tests (le service accepte `string` libre, les routes valident un enum strict, les tests seedent `metric: 'temp'`). C5 est une liste `parseExitReason` hardcodée dans la route `backtest.ts` qui duplique l'union `BacktestExitReason` core (drift si une nouvelle raison est ajoutée).

Le fil conducteur des trois fixes est le même : **éliminer la duplication d'une union de valeurs de chaînes** en la remplaçant par une **source de vérité unique** (const array typé) exportée depuis `@polywatch/core` et réutilisée côté routes, services, strategy et tests.

---

## 1. Contexte et problème

### 1.1 C3 — `VALID_TABLE_IDS` dupliqué

`weather-algo-data.service.ts:15-22` déclare l'union `WeatherAlgoDataTableId` (7 tables). La route `weather-algo-data.ts:6-14` redéclare une copie littérale `VALID_TABLE_IDS` dans le même ordre. Toute nouvelle table impose 2 edits manuels. `isValidTableId` (ligne 16-18) compare contre cette copie.

```6:18:packages/backend/src/routes/weather-algo-data.ts
const VALID_TABLE_IDS: readonly string[] = [
  'forecast_history',
  'market_snapshots',
  'bucket_ticks',
  'evaluation_log',
  'forecast_cache',
  'position_forecasts',
  'clob_price_history',
];

function isValidTableId(value: string): value is WeatherAlgoDataTableId {
  return (VALID_TABLE_IDS as readonly string[]).includes(value);
}
```

```15:22:packages/core/src/services/weather-algo-data.service.ts
export type WeatherAlgoDataTableId =
  | 'forecast_history'
  | 'market_snapshots'
  | 'bucket_ticks'
  | 'evaluation_log'
  | 'forecast_cache'
  | 'position_forecasts'
  | 'clob_price_history';
```

Le service exporte déjà `WeatherAlgoDataTableId` (via `packages/core/src/services/index.ts:180`), et la route l'importe (ligne 3). Le manque est un **runtime array** : une union type n'est pas énumérable au runtime, d'où la duplication littérale. Le fix est d'exporter une const array depuis le service (source de vérité runtime + type) et de supprimer la copie dans la route.

### 1.2 C4 — Restrictions `metric` inconsistantes

La matrice complète (audit §1.1) :

| Couche | Valeurs autorisées | Localisation |
|--------|-------------------|--------------|
| `parseWeatherQuestion` → `ParsedWeatherQuestion.metric` | `'highest_temp' \| 'lowest_temp'` | `question-parser.ts:3` |
| `fetchWeatherForecast` / `fetchMultiModelForecast` | `'highest_temp' \| 'lowest_temp'` | `weather-api-client.ts:66,184` |
| `discoverWeatherMarketsInRange` | `'highest_temp' \| 'lowest_temp'` | `weather-market-discovery.ts:230,262` |
| `groupMarketsByCity(AndDate)` | `'highest_temp' \| 'lowest_temp'` | `weather-market-discovery.ts:473,570` |
| `enrichCityGroupsWithForecast` | `'highest_temp' \| 'lowest_temp'` | `weather-forecast-enricher.ts:16,27` |
| `WeatherForecastService.getOrFetch` | **`'highest_temp' \| 'lowest_temp' \| string`** (string libre) | `weather-forecast.service.ts:45` |
| `WeatherForecastService.getCached` / `save` | `string` libre | `weather-forecast.service.ts:122,146` |
| `WeatherSignal.metric` | `'highest_temp' \| 'lowest_temp'` | `strategy.ts:14` |
| Route `weather-algo-forecasts` | enum strict (guard manuel) | `weather-algo-forecasts.ts:16-23` |
| Route `weather-algo-history` (ingest) | zod enum strict | `weather-algo-history.ts:15` |
| `WeatherHistoryIngestService` | `'highest_temp' \| 'lowest_temp'` (cast `as`) | `weather-history-ingest.service.ts:456` |
| `WeatherAutoTrackService.addRule` | **`string` libre (default `'highest_temp'`)** | `weather-auto-track.service.ts:27` |
| Tests core `weather-algo-data.service.test.ts` | **`metric: 'temp'`** (6 occurrences) | lignes 29, 48, 217, 332, 351, 382 |
| Frontend `api.ts` (types) | `string` / `'highest_temp' \| 'lowest_temp'` | lignes 684, 698, 754, 767, 1303 |

Problèmes :
- **Le service et `addRule` acceptent `string` libre** — une valeur invalide (`'temp'`, `'precip'`) est persistée ou passée à l'API Open-Meteo (qui n'a de mapping que `highest_temp`/`lowest_temp`, cf. `weather-api-client.ts:69`). Le cast `metric as 'highest_temp'|'lowest_temp'` (ligne 68) masque le risque au lieu de le gérer.
- **Les tests seedent `metric: 'temp'`** — valeur absente des enums de routes → incohérence de données possible (le serializer/service ne valide pas, la valeur atterrit en DB).
- L'union `'highest_temp' \| 'lowest_temp'` est **répétée ~10 fois** dans le code → la même dette de duplication que C3/C5, appliquée au metric.

Le fix : introduire un type canonique `WeatherMetric` + un guard runtime `isWeatherMetric` dans `@polywatch/core`, remplacer les unions répétées, resserrer les signatures du service/`addRule`, et corriger les tests.

### 1.3 C5 — `parseExitReason` hardcodé

`backtest.ts:59-67` hardcode une liste de 10 raisons qui duplique l'union `BacktestExitReason` de `BacktestPosition.ts:3-13`. Le type est bien importé (ligne 9), mais l'énumération runtime est recopiée. Si une nouvelle raison est ajoutée à l'union, la liste de la route ne sera pas mise à jour → un filtre légitime par la nouvelle raison retournerait `null` (pas d'erreur, silencieux).

```59:67:packages/backend/src/routes/backtest.ts
function parseExitReason(value: unknown): BacktestExitReason | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const known: BacktestExitReason[] = [
    'SL', 'TP', 'TRAILING', 'RESOLUTION', 'STRATEGY_FLIP', 'WINDOW_CLOSE',
    'KILL_SWITCH',
    'WEATHER_PRE_CLOSE', 'WEATHER_FORECAST_CHANGE', 'WEATHER_BUCKET_EXIT',
  ];
  return known.includes(value as BacktestExitReason) ? (value as BacktestExitReason) : null;
}
```

```3:13:packages/core/src/entities/BacktestPosition.ts
export type BacktestExitReason =
  | 'SL'
  | 'TP'
  | 'TRAILING'
  | 'RESOLUTION'
  | 'STRATEGY_FLIP'
  | 'WINDOW_CLOSE'
  | 'KILL_SWITCH'
  | 'WEATHER_PRE_CLOSE'
  | 'WEATHER_FORECAST_CHANGE'
  | 'WEATHER_BUCKET_EXIT';
```

Le fix : convertir l'union en une **const array** `BACKTEST_EXIT_REASONS` (dans `BacktestPosition.ts`), dériver le type depuis l'array, exporter l'array via `@polywatch/core`, et l'utiliser dans la route.

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| **Pattern commun** | Const array typée `as const` exportée depuis `@polywatch/core` + type dérivé | C3, C4, C5 ont la même structure : une union de littéraux dupliquée à l'écrit. On centralise dans un module core et on dérive le type depuis l'array pour garantir la cohérence runtime/type. |
| **C3-tableIds-source** | Exporter `WEATHER_ALGO_DATA_TABLE_IDS` (const array) depuis `weather-algo-data.service.ts`, dériver `WeatherAlgoDataTableId = typeof ... [number]` | Le service est déjà la source du type. La route n'importe plus `VALID_TABLE_IDS` ; `isValidTableId` devient un simple `includes` sur l'array importé. |
| **C4-metric-source** | Créer le type `WeatherMetric = 'highest_temp' \| 'lowest_temp'` dans `packages/core/src/weather/metric.ts` + guard `isWeatherMetric(value)` | Nouveau module leaf (zéro import, pas de cycle). Exporté via `packages/core/src/index.ts`. Remplacer les ~10 unions répétées. |
| **C4-service-strict** | Reserrer `getOrFetch` / `getCached` / `save` et `addRule` sur `WeatherMetric` | Le guard runtime à la frontière route/ingest empêche les valeurs invalides. Le service n'accepte plus `string` libre (plus de cast masquant). |
| **C4-routes-guard** | Réutiliser `isWeatherMetric` dans les 2 routes (`weather-algo-forecasts`, `weather-algo-history`) | Remplacer le guard manuel et le zod enum par le helper partagé. `isWeatherMetric` devient le seul point de validation runtime. |
| **C4-tests** | Remplacer `metric: 'temp'` par `metric: 'highest_temp'` dans `weather-algo-data.service.test.ts` | Les tests reflètent désormais une valeur valide, cohérente avec les routes. |
| **C4-backward-compat** | Aucun changement de contrat API | Les valeurs autorisées restent identiques (`highest_temp`/`lowest_temp`). Seule la validation devient partagée et stricte. |
| **C5-exitReason-source** | Convertir `BacktestExitReason` en `type` dérivé d'une const array `BACKTEST_EXIT_REASONS` exportée | La route importe l'array et fait un `includes`. Suppression de la liste littérale. Le type reste exporté (même nom) — aucun caller de type à changer. |

---

## 3. Architecture cible

```
[core] weather/metric.ts
  export const WEATHER_METRICS = ['highest_temp','lowest_temp'] as const
  export type WeatherMetric = typeof WEATHER_METRICS[number]
  export function isWeatherMetric(v: unknown): v is WeatherMetric

  └─ parsé/utilisé par : question-parser, weather-api-client, weather-market-discovery,
     weather-forecast-enricher, weather-forecast.service, weather-auto-track.service,
     strategy.ts (WeatherSignal), routes weather-algo-forecasts / weather-algo-history,
     tests.

[core] entities/BacktestPosition.ts
  export const BACKTEST_EXIT_REASONS = [ ... ] as const
  export type BacktestExitReason = typeof BACKTEST_EXIT_REASONS[number]

[core] services/weather-algo-data.service.ts
  export const WEATHER_ALGO_DATA_TABLE_IDS = [ ... ] as const
  export type WeatherAlgoDataTableId = typeof WEATHER_ALGO_DATA_TABLE_IDS[number]

[backend] routes/weather-algo-data.ts      → importe WEATHER_ALGO_DATA_TABLE_IDS (plus de VALID_TABLE_IDS)
[backend] routes/backtest.ts               → importe BACKTEST_EXIT_REASONS (plus de liste littérale)
[backend] routes/weather-algo-forecasts.ts → utilise isWeatherMetric
[backend] routes/weather-algo-history.ts   → utilise isWeatherMetric
[core]    weather-forecast.service.ts      → signatures sur WeatherMetric
[core]    weather-auto-track.service.ts    → addRule(metric: WeatherMetric)
```

---

## 4. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `packages/core/src/weather/metric.ts` *(nouveau)* | Const array `WEATHER_METRICS` + type `WeatherMetric` + guard `isWeatherMetric` | C4 |
| `packages/core/src/index.ts` | Exporter `WEATHER_METRICS`, `WeatherMetric`, `isWeatherMetric` | C4 |
| `packages/core/src/weather/question-parser.ts` | `ParsedWeatherQuestion.metric` → `WeatherMetric` | C4 |
| `packages/core/src/weather/weather-api-client.ts` | Signatures `metric` → `WeatherMetric` | C4 |
| `packages/core/src/weather/weather-market-discovery.ts` | Options/params `metric` → `WeatherMetric` | C4 |
| `packages/core/src/weather/weather-forecast-enricher.ts` | `EnrichForecastOptions.metric` → `WeatherMetric` | C4 |
| `packages/core/src/services/weather-forecast.service.ts` | `getOrFetch`/`getCached`/`save` `metric` → `WeatherMetric` (suppression du cast masquant) | C4 |
| `packages/core/src/services/weather-auto-track.service.ts` | `addRule(metric: WeatherMetric = 'highest_temp')` | C4 |
| `packages/core/src/services/weather-history-ingest.service.ts` | Cast `as 'highest_temp'\|'lowest_temp'` → `WeatherMetric` | C4 |
| `packages/weather-algo/src/strategy/strategy.ts` | `WeatherSignal.metric` → `WeatherMetric` | C4 |
| `packages/backend/src/routes/weather-algo-forecasts.ts` | Guard manuel → `isWeatherMetric` | C4 |
| `packages/backend/src/routes/weather-algo-history.ts` | zod enum → `isWeatherMetric` | C4 |
| `packages/backend/src/routes/weather-algo-auto-track.ts` | Préserver le `@deprecated` sur `metric` (le service hardcode `'highest_temp'`) ; pas de guard `isWeatherMetric` nécessaire | C4 (no-op) |
| `packages/core/src/services/weather-algo-data.service.test.ts` | `metric: 'temp'` → `'highest_temp'` (6 occurrences) | C4 |
| `packages/backend/src/routes/weather-algo-data.ts` | Supprimer `VALID_TABLE_IDS`, importer `WEATHER_ALGO_DATA_TABLE_IDS` | C3 |
| `packages/core/src/services/weather-algo-data.service.ts` | Convertir l'union en const array + type dérivé | C3 |
| `packages/core/src/entities/BacktestPosition.ts` | Convertir l'union en const array `BACKTEST_EXIT_REASONS` + type dérivé | C5 |
| `packages/core/src/entities/index.ts` | Exporter `BACKTEST_EXIT_REASONS` | C5 |
| `packages/backend/src/routes/backtest.ts` | `parseExitReason` → `includes(BACKTEST_EXIT_REASONS)` | C5 |
| `packages/frontend/src/api.ts` | Types `metric: string` → `WeatherMetric` (types DTO + ingest) | C4 |

> **Frontend C4 (décision 2026-08-12)** : les DTO `metric: string` (api.ts:684, 698, 754, 767) reflètent des valeurs qui ne peuvent être que `highest_temp`/`lowest_temp`. On les resserre sur `WeatherMetric` (importé depuis `@polywatch/core`). L'ingest (ligne 1303) passe déjà `'highest_temp' \| 'lowest_temp'` → remplacé par `WeatherMetric`. Élimine l'ambiguïté restante et aligne le frontend sur la source de vérité core.

---

## 5. Détail des changements

### 5.1 C3 — `weather-algo-data.service.ts` (const array source)

```typescript
// packages/core/src/services/weather-algo-data.service.ts
export const WEATHER_ALGO_DATA_TABLE_IDS = [
  'forecast_history',
  'market_snapshots',
  'bucket_ticks',
  'evaluation_log',
  'forecast_cache',
  'position_forecasts',
  'clob_price_history',
] as const;

export type WeatherAlgoDataTableId = (typeof WEATHER_ALGO_DATA_TABLE_IDS)[number];
```

> Remplacer l'union actuelle (lignes 15-22). L'array est la seule source ; le type en est dérivé. La const est exportée via `packages/core/src/services/index.ts` (déjà exporté : `type WeatherAlgoDataTableId` — ajouter la const).

### 5.2 C3 — `weather-algo-data.ts` (route)

```typescript
// packages/backend/src/routes/weather-algo-data.ts
import {
  WeatherAlgoDataService,
  WEATHER_ALGO_DATA_TABLE_IDS,
  type WeatherAlgoDataTableId,
} from '@polywatch/core';

function isValidTableId(value: string): value is WeatherAlgoDataTableId {
  return (WEATHER_ALGO_DATA_TABLE_IDS as readonly string[]).includes(value);
}
```

> Supprimer la déclaration `VALID_TABLE_IDS` (lignes 6-14). `isValidTableId` reste un type guard sur la source unique.

### 5.3 C4 — `metric.ts` (nouveau module core)

```typescript
// packages/core/src/weather/metric.ts
export const WEATHER_METRICS = ['highest_temp', 'lowest_temp'] as const;
export type WeatherMetric = (typeof WEATHER_METRICS)[number];

export function isWeatherMetric(value: unknown): value is WeatherMetric {
  return typeof value === 'string' && (WEATHER_METRICS as readonly string[]).includes(value);
}
```

Exporter dans `packages/core/src/index.ts` :

```typescript
export {
  WEATHER_METRICS,
  isWeatherMetric,
  type WeatherMetric,
} from './weather/metric.js';
```

### 5.4 C4 — Remplacer les unions répétées

Chaque fichier remplace `'highest_temp' | 'lowest_temp'` par `WeatherMetric` (importé de `@polywatch/core` ou du module `../weather/metric.js` selon la couche) :

```typescript
// weather-forecast.service.ts — AVANT
async getOrFetch(
  city: string,
  forecastDate: Date,
  metric: 'highest_temp' | 'lowest_temp' | string,   // ← string libre
  ttlMs: number = 3600_000,
): Promise<GetOrFetchResult | null> {

// APRÈS
import type { WeatherMetric } from '../weather/metric.js';
async getOrFetch(
  city: string,
  forecastDate: Date,
  metric: WeatherMetric,
  ttlMs: number = 3600_000,
): Promise<GetOrFetchResult | null> {
```

Même remplacement pour :
- `getCached(city, forecastDate, metric: WeatherMetric)` (ligne 122)
- `save(result: ForecastResult)` — `ForecastResult.metric: string` → `WeatherMetric` (ligne 11)
- Le cast `metric as 'highest_temp'|'lowest_temp'` ligne 68 de `getOrFetch` disparaît (metric est déjà `WeatherMetric`).

**Casts `as` à remplacer par un guard runtime** (sites de drift non couverts par la v1 du plan) :
- `strategy-runner.ts:467` : `const metric = (rule.metric || 'highest_temp') as 'highest_temp' | 'lowest_temp';` → `const metricRaw = rule.metric || 'highest_temp'; if (!isWeatherMetric(metricRaw)) continue; const metric: WeatherMetric = metricRaw;` — `rule.metric` vient de `WeatherAutoTrackRule.metric: string` (colonne DB TEXT). Le cast masquait une valeur invalide ; le guard explicite la rejette.
- `weather-exit-evaluator.ts:122` : `snapshot.metric as 'highest_temp' | 'lowest_temp'` → `isWeatherMetric(snapshot.metric) ? snapshot.metric : 'highest_temp'` (fallback) ou `if (!isWeatherMetric(snapshot.metric)) return;` selon le comportement souhaité. `snapshot.metric` vient de `WeatherMarketSnapshot.metric: string` (entity, colonne DB TEXT). **Ne pas resserer l'entité** (voir §5.4.1 Entités DB).
- `weather-history-ingest.service.ts:456` : `const metric = job.metric as 'highest_temp' | 'lowest_temp';` → `if (!isWeatherMetric(job.metric)) { log.warn(...); return; } const metric: WeatherMetric = job.metric;` — `job.metric` vient de `WeatherHistoryIngestJob.metric: string`. La valeur est validée à l'écrit par la route (zod), mais un guard à la lecture reste défensif.

**Unions littérales à remplacer par `WeatherMetric`** :
- `weather-auto-track.service.ts:27` : `addRule(city, metric: WeatherMetric = 'highest_temp', ...)` ; supprimer la ligne 32 `resolvedMetric` (le default est déjà `WeatherMetric`, plus besoin de `metric || 'highest_temp'`).
- `weather-market-discovery.ts:230,262,473,570` ; `weather-forecast-enricher.ts:16,27` ; `weather-api-client.ts:66,184` ; `question-parser.ts:3` ; `strategy.ts:14` — remplacer l'union littérale par `WeatherMetric`.

### 5.4.1 C4 — Entités DB (périmètre explicite)

**On ne resserre PAS les colonnes `metric` des entités TypeORM**. Les colonnes DB restent `string` / `string | null` :

| Entité | Colonne | Raison |
|--------|---------|--------|
| `WeatherForecastCache.metric` | `text` (ligne 22) | Row legacy `'temp'` possible → resserer casserait la lecture. |
| `WeatherMarketSnapshot.metric` | `text` (ligne 20) | Le test `weather-adapter.test.ts:417` seed intentionnellement `'precip'` pour documenter le non-support. |
| `WeatherBucketTick.metric` | `text NULL` (ligne 25) | Idem. |
| `WeatherClobPriceHistory.metric` | `text` (ligne 24) | Idem. |
| `WeatherAutoTrackRule.metric` | `text` (ligne 20) | Rows legacy. |
| `WeatherHistoryIngestJob.metric` | `text` (ligne 27) | Rows legacy. |

**Conséquence** : le type `ForecastResult.metric` (interface TS, pas une entité) est resserré sur `WeatherMetric`, mais `getCached` lit `row.metric: string` et doit le valider via `isWeatherMetric` avant de l'affecter au `ForecastResult`. Ajouter à `getCached` :

```typescript
const metric = isWeatherMetric(row.metric) ? row.metric : row.metric as WeatherMetric;
// ou, défensif : logger.warn + return null si row.metric invalide
```

**Choix recommandé** : `getCached` retourne `null` si `row.metric` n'est pas un `WeatherMetric` valide (anomalie legacy → on skip plutôt que corrompre le type). Documenter ce comportement.

> **Note** : `weather-adapter.test.ts:417,426` seedent `metric: 'precip'` dans `WeatherMarketSnapshot`/`WeatherBucketTick`. Ces tests **ne cassent pas** car les colonnes restent `string`. Le test documente que le backtest skip les buckets `precip` (warning `unsupported_metric_or_bucket`). Aucun changement à ce test.

### 5.5 C4 — Routes (guard partagé)

**`weather-algo-forecasts.ts`** — remplacer le guard manuel (lignes 16-23) :

```typescript
// packages/backend/src/routes/weather-algo-forecasts.ts
import { isWeatherMetric, type WeatherMetric } from '@polywatch/core';

const metricRaw = String(req.query.metric ?? 'highest_temp');
if (!isWeatherMetric(metricRaw)) {
  res.status(400).json({
    error: 'invalid_metric',
    message: `metric must be 'highest_temp' or 'lowest_temp'`,
  });
  return;
}
const metric = metricRaw as WeatherMetric;
```

**`weather-algo-history.ts`** — remplacer le zod enum (ligne 15) :

```typescript
// packages/backend/src/routes/weather-algo-history.ts
import { isWeatherMetric, type WeatherMetric } from '@polywatch/core';
import { z } from 'zod';

const ingestBodySchema = z.object({
  city: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fidelityMinutes: z.number().int().min(1).max(1440),
  metric: z.custom<WeatherMetric>((v) => isWeatherMetric(v)).optional(),
});
```

> `isWeatherMetric` devient le **seul** point de validation runtime du metric, utilisé par les deux routes.

### 5.6 C4 — Tests (`weather-algo-data.service.test.ts`)

Remplacer les 6 occurrences `metric: 'temp'` (lignes 29, 48, 217, 332, 351, 382) par `metric: 'highest_temp'`.

```typescript
// AVANT
metric: 'temp',
// APRÈS
metric: 'highest_temp',
```

### 5.7 C5 — `BacktestPosition.ts` (const array source)

```typescript
// packages/core/src/entities/BacktestPosition.ts
export const BACKTEST_EXIT_REASONS = [
  'SL',
  'TP',
  'TRAILING',
  'RESOLUTION',
  'STRATEGY_FLIP',
  'WINDOW_CLOSE',
  'KILL_SWITCH',
  'WEATHER_PRE_CLOSE',
  'WEATHER_FORECAST_CHANGE',
  'WEATHER_BUCKET_EXIT',
] as const;

export type BacktestExitReason = (typeof BACKTEST_EXIT_REASONS)[number];
```

> Remplacer l'union (lignes 3-13). Le nom de type reste `BacktestExitReason` — tous les importeurs de type (`backtest-run.service.ts`, `exit-manager.ts`, `ledger.ts`, `fill-engine.ts`) restent valides. Exporter la const dans `packages/core/src/entities/index.ts` :

```typescript
export { BacktestPosition, BACKTEST_EXIT_REASONS, type BacktestExitReason } from './BacktestPosition.js';
```

### 5.8 C5 — `backtest.ts` (route)

```typescript
// packages/backend/src/routes/backtest.ts
import { BACKTEST_EXIT_REASONS, type BacktestExitReason } from '@polywatch/core';

function parseExitReason(value: unknown): BacktestExitReason | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (BACKTEST_EXIT_REASONS as readonly string[]).includes(value)
    ? (value as BacktestExitReason)
    : null;
}
```

> Suppression de la liste littérale (lignes 61-65). La source unique est `BACKTEST_EXIT_REASONS`.

---

## 6. Ordre d'implémentation

### Phase 1 — Core (types sources + metric)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 1 | Créer `metric.ts` (`WEATHER_METRICS`/`WeatherMetric`/`isWeatherMetric`) | `weather/metric.ts` *(nouveau)* | 5 min |
| 2 | Exporter depuis `index.ts` | `packages/core/src/index.ts` | 2 min |
| 3 | Convertir l'union `WeatherAlgoDataTableId` en const array | `weather-algo-data.service.ts` | 5 min |
| 4 | Convertir l'union `BacktestExitReason` en const array | `entities/BacktestPosition.ts` | 5 min |
| 5 | Exporter `BACKTEST_EXIT_REASONS` | `entities/index.ts` | 2 min |
| 6 | Remplacer les unions `metric` dans le core (`question-parser`, `weather-api-client`, `weather-market-discovery`, `weather-forecast-enricher`) | 4 fichiers | 15 min |
| 7 | Reserrer `getOrFetch`/`getCached`/`save` (`ForecastResult.metric`) + suppression du cast + guard `isWeatherMetric` sur `row.metric` dans `getCached` | `weather-forecast.service.ts` | 15 min |
| 8 | Reserrer `addRule` + supprimer `resolvedMetric` | `weather-auto-track.service.ts` | 3 min |
| 9 | Remplacer le cast `job.metric` par guard `isWeatherMetric` | `weather-history-ingest.service.ts` | 5 min |
| 10 | Remplacer l'union dans `WeatherSignal.metric` | `packages/weather-algo/src/strategy/strategy.ts` | 2 min |
| 10b | Remplacer le cast `rule.metric` (l.467) par guard `isWeatherMetric` | `strategy-runner.ts` | 5 min |
| 10c | Remplacer le cast `snapshot.metric` (l.122) par guard `isWeatherMetric` | `weather-exit-evaluator.ts` | 5 min |
| 11 | Build core + weather-algo | `npm run build -w @polywatch/core && npm run build -w @polywatch/weather-algo` | 2 min |

### Phase 2 — Backend (routes)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 12 | Importer `WEATHER_ALGO_DATA_TABLE_IDS`, supprimer `VALID_TABLE_IDS` | `routes/weather-algo-data.ts` | 5 min |
| 13 | `parseExitReason` → `includes(BACKTEST_EXIT_REASONS)` | `routes/backtest.ts` | 5 min |
| 14 | Guard `isWeatherMetric` dans forecasts | `routes/weather-algo-forecasts.ts` | 5 min |
| 15 | zod enum → `isWeatherMetric` | `routes/weather-algo-history.ts` | 5 min |
| 16 | (si présent) `metric` → `isWeatherMetric` | `routes/weather-algo-auto-track.ts` *(no-op — `@deprecated`, préserver)* | — |
| 17 | Build backend | `npm run build -w @polywatch/backend` | 2 min |

### Phase 3 — Frontend (metric resserré)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 18 | Resserrer `metric: string` → `WeatherMetric` (DTO forecast/history/snapshot/position) + `WeatherHistoryIngestParams.metric` → `WeatherMetric` | `frontend/src/api.ts` | 10 min |
| 19 | Build frontend | `npm run build -w @polywatch/frontend` | 2 min |

### Phase 4 — Tests + validation

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 20 | Remplacer `metric: 'temp'` → `'highest_temp'` (6x) | `weather-algo-data.service.test.ts` | 10 min |
| 21 | (optionnel) Tests `isWeatherMetric` / `WEATHER_METRICS` | `weather/metric.test.ts` *(nouveau)* | 10 min |
| 22 | Lancer les tests | `npm test` | 5 min |
| 23 | ReadLints sur les fichiers modifiés | — | 5 min |

**Effort total estimé** : ~2h

---

## 7. Tests

| Composant | Test | Constat |
|-----------|------|---------|
| `isWeatherMetric` | `'highest_temp'` / `'lowest_temp'` → `true` ; `'temp'`, `'precip'`, `''`, `null` → `false` | C4 |
| `WEATHER_METRICS` | Contient exactement les 2 valeurs, ordre stable | C4 |
| `WeatherAlgoDataTableId` | Dérivé de `WEATHER_ALGO_DATA_TABLE_IDS` (7 valeurs, même ordre) | C3 |
| Route `DELETE /tables/:id` | `id` valide → 200 ; `id` invalide → 400 (comportement inchangé) | C3 |
| `parseExitReason` | Chaque membre de `BACKTEST_EXIT_REASONS` → validé ; `'UNKNOWN'`/`''` → `null` | C5 |
| `BACKTEST_EXIT_REASONS` | Exposé depuis `@polywatch/core`, 10 valeurs | C5 |
| `WeatherForecastService.getOrFetch` | Signature `WeatherMetric` (compile-time) ; les tests existants passent | C4 |
| `WeatherForecastService.getCached` | `row.metric` invalide (legacy `'temp'`) → retourne `null` (anomalie skip) | C4 |
| `weather-adapter.test.ts` (no-op) | `metric: 'precip'` seed → test passe toujours (colonne entité `string` inchangée) | C4 |
| `strategy-runner` cast fix | `rule.metric` invalide → `continue` (skip rule, pas de crash) | C4 |
| Route `weather-algo-forecasts` | `metric=temp` → 400 ; `metric=highest_temp` → 200 (comportement inchangé) | C4 |
| Route `weather-algo-history` ingest | `metric` absent/valide → 202 ; invalide → 400 (comportement inchangé) | C4 |
| Tests `weather-algo-data.service.test.ts` | Seedent `metric: 'highest_temp'` (pas `'temp'`) | C4 |

---

## 8. Risques résiduels

| Risque | Mitigation |
|--------|------------|
| **R-C3-1** : La route importe `WEATHER_ALGO_DATA_TABLE_IDS` mais l'export du core n'est pas exposé via `services/index.ts`. | Ajouter la const à l'export existant (`services/index.ts:180`). Vérifier au build. |
| **R-C4-1** *(résolu — frontend inclus)* : Resserrer le frontend `api.ts` (`metric: string` → `WeatherMetric`) impose d'importer `WeatherMetric` côté frontend. | **Inclus** (décision 2026-08-12) : le resserrage frontend fait partie du périmètre. `@polywatch/core` est déjà une dépendance du frontend — l'import type `WeatherMetric` est direct. Vérifier au build frontend. |
| **R-C4-2** *(mis à jour)* : Reserrer `getOrFetch`/`getCached`/`save` sur `WeatherMetric` casse les callers qui passent `string` via un cast `as`. 4 casts `as 'highest_temp'\|'lowest_temp'` existent : `strategy-runner.ts:467` (`rule.metric`), `weather-exit-evaluator.ts:122` (`snapshot.metric`), `weather-forecast.service.ts:68` (interne), `weather-algo-forecasts.ts:23` (route). | Chaque cast est remplacé par un guard `isWeatherMetric` runtime (§5.4). Les callers identifiés (`weather-forecast-enricher`, `weather-entry-pipeline.ts:542`, `strategy-runner.ts:591`, `weather-exit-evaluator.ts:119`) passent une variable typée provenant d'une entité DB `string` — le guard valide au runtime. |
| **R-C4-3** *(mis à jour)* : `ForecastResult.metric` resserré sur `WeatherMetric` mais 6 entités DB ont `metric: string`/`string\|null` → rows legacy `'temp'`/`'precip'` possibles. | **On ne resserre PAS les colonnes entité** (§5.4.1). `getCached` valide `row.metric` via `isWeatherMetric` et retourne `null` sur valeur invalide (anomalie legacy). Le test `weather-adapter.test.ts:417` seed `metric: 'precip'` reste valide (colonne `string` inchangée). Les tests `weather-algo-data.service.test.ts` seedant `'temp'` sont corrigés. |
| **R-C5-1** : Changer `BacktestExitReason` d'une union écrite à un type dérivé d'une const array. | Le type résultant est structurellement identique. Aucun caller de type (`backtest-run.service`, `exit-manager`, `ledger`, `fill-engine`) ne change. Seule la const est ajoutée à l'export. |
| **R-X-1** : Dépendance circulaire possible si `metric.ts` est importé largement dans le core. | `metric.ts` est un module leaf (zéro import). Tous les importeurs pointent vers un leaf → aucun cycle. |
| **R-X-2** : `weather-algo-data.service.ts` (core) importé par la route backend — la const array doit être re-exportée par le barrel core. | `WEATHER_ALGO_DATA_TABLE_IDS` ajoutée à l'export de `services/index.ts`. Vérifié par le build backend. |

---

## 9. Checklist prod

- [x] `npm run build -w @polywatch/core` — passe sans erreur
- [x] `npm run build -w @polywatch/weather-algo` — passe sans erreur
- [x] `npm run build -w @polywatch/backend` — passe sans erreur
- [x] `npm run build -w @polywatch/frontend` — passe (frontend inclus : `api.ts` resserré sur `WeatherMetric`)
- [x] `npm test` — aucun nouveau échec (5 échecs core + 1 backend pré-existants, hors périmètre, non introduits)
- [x] ReadLints — aucun nouveau lint error sur les fichiers modifiés (4 warnings pré-existants)
- [ ] Smoke test route `DELETE /weather-algo-data/tables/:id` — id valide → 200, invalide → 400 *(à valider en env)*
- [ ] Smoke test `GET /backtest/:id/positions?exitReason=WEATHER_PRE_CLOSE` — filtre fonctionne *(à valider en env)*
- [ ] Smoke test `GET /weather-algo-forecasts/:city/:date?metric=temp` → 400 ; `metric=highest_temp` → 200 *(à valider en env)*
- [ ] Smoke test ingest `POST /weather-algo-history/ingest` — `metric` invalide → 400 *(à valider en env)*
- [x] `git diff --stat` — confirmer le périmètre des fichiers modifiés (22 fichiers, alignés sur le §4)

---

## 10. Critère de complétude

- [x] C3 : `VALID_TABLE_IDS` supprimé de la route `weather-algo-data.ts`
- [x] C3 : `WEATHER_ALGO_DATA_TABLE_IDS` est la source unique (exportée par `@polywatch/core`)
- [x] C3 : `WeatherAlgoDataTableId` dérivé de la const array
- [x] C4 : `WeatherMetric` + `isWeatherMetric` définis et exportés par `@polywatch/core`
- [x] C4 : `weather-forecast.service.ts` (getOrFetch/getCached/save) n'accepte plus `string` libre
- [x] C4 : `weather-auto-track.service.ts:addRule` est resserré sur `WeatherMetric`
- [x] C4 : Les 2 routes utilisent `isWeatherMetric` (plus de guard manuel / zod enum dupliqué)
- [x] C4 : Les unions `metric` répétées (~10 sites) remplacées par `WeatherMetric`
- [x] C4 : Les tests seedent `metric: 'highest_temp'` (plus de `'temp'`)
- [x] C4 : Le frontend `api.ts` resserré sur `WeatherMetric` (DTO + ingest)
- [x] C4 : Les 4 casts `as 'highest_temp'|'lowest_temp'` remplacés par `isWeatherMetric` (strategy-runner:467, exit-evaluator:122, history-ingest:456, forecasts:23)
- [x] C4 : `getCached` valide `row.metric` via `isWeatherMetric` (return null sur invalide)
- [x] C4 : Les colonnes entité `metric: string` sont **inchangées** (pas de migration)
- [x] C4 : `weather-adapter.test.ts` (`metric: 'precip'`) passe toujours (no-op)
- [x] C5 : `parseExitReason` utilise `BACKTEST_EXIT_REASONS` (plus de liste littérale)
- [x] C5 : `BacktestExitReason` dérivé de la const array, export inchangé
- [x] Build core / weather-algo / backend / frontend passent
- [x] Tests passent ; aucun nouveau lint error
- [x] Aucun fichier hors périmètre modifié

---

## 11. Audit du plan (2026-08-12)

Revérification de chaque claim du plan par lecture directe du code sur disque. Corrections apportées :

- **Casts `as` manquants (E1)** : la v1 du plan ne listait que l'union à remplacer mais ignorait 4 casts `as 'highest_temp'|'lowest_temp'` qui sont les vrais sites de drift runtime (`strategy-runner.ts:467`, `weather-exit-evaluator.ts:122`, `weather-history-ingest.service.ts:456`, `weather-forecast.service.ts:68`). Ajoutés au §5.4 avec guards `isWeatherMetric` explicites.
- **Test `weather-adapter.test.ts` `metric: 'precip'` (E2)** : la v1 ne mentionnait que les 6 `'temp'` de `weather-algo-data.service.test.ts`. Il existe aussi 2 `'precip'` intentionnels (`weather-adapter.test.ts:417,426`) documentant le non-support. Le plan resserre les types de service mais **ne touche pas aux colonnes entité** → le test reste valide. Ajouté au §5.4.1.
- **Import `WeatherMetric` manquant dans zod (E3)** : la v1 du §5.5 importait `isWeatherMetric` mais utilisait `z.custom<WeatherMetric>` sans importer le type. Corrigé.
- **Entités DB non couvertes (Z1)** : 6 entités ont `metric: string`/`string|null`. La v1 resserait `ForecastResult.metric` (interface TS) sans dire comment `getCached` doit gérer `row.metric: string`. Ajouté §5.4.1 : `getCached` valide via `isWeatherMetric` et retourne `null` sur invalide. Les colonnes entité restent `string`.
- **Route `weather-algo-auto-track.ts` (Z2)** : la v1 listait cette route en « (si `metric` param) ». En réalité le `metric` est `@deprecated` et le service hardcode `'highest_temp'`. Reclassé en no-op (§4, §6 phase 2).
- **`weather-history-ingest.service.ts:456` (Z3)** : le cast `job.metric as 'highest_temp'|'lowest_temp'` lit `WeatherHistoryIngestJob.metric: string`. La v1 disait juste remplacer par `as WeatherMetric` (toujours un cast non validé). Remplacé par guard `isWeatherMetric` runtime (§5.4).

**Callers de `getOrFetch`/`getCached` vérifiés** (tous passent une variable typée provenant d'une entité DB `string`, validée par guard en amont) :
- `strategy-runner.ts:591` : `metric` provient de `rule.metric` (guardé l.467 après fix)
- `weather-exit-evaluator.ts:119` : `snapshot.metric` (guardé l.122 après fix)
- `weather-entry-pipeline.ts:542` : `signal.metric` (WeatherSignal.metric resserré sur `WeatherMetric` → safe)
- `weather-forecast-enricher.ts:54,104` : `metric` local, default `'highest_temp'` (déjà `WeatherMetric` après fix)
- `weather-algo-forecasts.ts:35` : `metric` guardé par `isWeatherMetric` (après fix)

**Résolu** : aucun caller ne passe une valeur non-validée après les fixes. Les 4 casts sont remplacés par guards runtime. Aucune migration nécessaire.

---

## 12. Vérification post-implémentation (2026-08-12)

Audit complet du code sur disque après implémentation. Tous les items du §10 sont vérifiés par lecture directe.

### 12.1 Bug réel détecté et corrigé

- **[Bug] `weather-history-ingest.service.ts:459-462`** : le guard `isWeatherMetric` ajouté au `runJob` marquait le job en `status: 'error'` + `errorMessage: 'invalid_metric'` mais **omettait `finishedAt`**, contrairement à tous les autres sites d'erreur du même fichier (lignes 259, 280, 517 qui set tous `finishedAt: new Date()`). Conséquence : un job invalidé par metric restait avec `finishedAt: null`, ce qui pouvait le faire apparaître comme "en cours" indéfiniment pour la conflict guard (`markStaleJobs` / `hasActiveJob`) et bloquer toute nouvelle ingestion pour la même ville. **Corrigé** : `finishedAt: new Date()` ajouté à l'update. Tests `weather-history-ingest.service.test.ts` (15/15) toujours verts.

### 12.2 Bugs fantômes

- **Aucun**. Les guards `isWeatherMetric` en `getCached` (return null sur invalide), `strategy-runner` (continue/skip rule), `weather-exit-evaluator` (return/skip exit checks) et `weather-history-ingest` (abort job + finishedAt) gèrent explicitement les valeurs invalides sans état corrompu.
- `weather-exit-evaluator.test.ts` : le mock `@polywatch/core` fournit `isWeatherMetric` (retourne `true` pour `highest_temp`/`lowest_temp`) — les fixtures seed `metric: 'highest_temp'`, cohérent.

### 12.3 Refactor

- **Optionnel** : `weather-market-discovery.ts:470` — commentaire JSDoc `'highest_temp' | 'lowest_temp'` cosmétique pourrait mentionner `WeatherMetric` pour cohérence, mais sans valeur fonctionnelle.

### 12.4 Vérification de non-régression

- **Builds** : core, weather-algo, backend, frontend → tous OK.
- **Tests** : weather-algo 60/60, backtest 28/28, weather-history-ingest 15/15, weather-algo-data 18/18, metric.test.ts 3/3.
- **5 échecs core + 1 backend pré-existants** (`market-metadata` AbortSignal, `policy` trailing, `snapshot-decision-collector-parity`, `resume-reserved-entry` MOS, `config.sim-execution` Zod crypto) — fichiers non modifiés, hors périmètre.
- **Lint** : 0 erreur (4 warnings pré-existants : `parseOptionalDate`, `log`, `redisCmd`, `markets`).
- **Périmètre** : 22 fichiers modifiés, alignés sur le §4. Aucun fichier hors périmètre touché.

### 12.5 Verdict

Implémentation correcte et conforme au plan. Un bug réel (job bloqué sans `finishedAt`) a été détecté pendant l'audit et corrigé. Aucune régression introduite. Prêt à merger.
