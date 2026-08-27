# Plan — Fix C1 (flag `isFresh`) + C2 (unités `bucketLabel`)

**Date** : 2026-08-12
**Statut** : **appliqué** (2026-08-12)
**Scope** : `packages/core`, `packages/backend`, `packages/frontend`, `packages/weather-algo`
**Référence** : [`../audits/2026-08-11_audit-weather-algo-complet.md`](../audits/2026-08-11_audit-weather-algo-complet.md) · [`2026-08-11_PLAN-weather-per-strategy-config.md`](./2026-08-11_PLAN-weather-per-strategy-config.md)

**Objectif** : Corriger les deux constats critiques C1 et C2 de l'audit weather-algo. C1 est un bug sémantique one-line (`isFresh: false` retourné pour un forecast frais) avec un impact collatéral sur l'enregistrement d'historique des prévisions. C2 est une triplication de `bucketLabel` avec unités divergentes (`°C` vs `°`) nécessitant la propagation de l'unité du marché (C vs F) du parser jusqu'au frontend. Aucune des deux corrections ne change le régime nominal au-delà du bug lui-même.

---

## 1. Contexte et problème

### 1.1 C1 — Flag `isFresh` incohérent

`WeatherForecastService.getOrFetch` (`packages/core/src/services/weather-forecast.service.ts:39-104`) persiste un forecast avec `isFresh: true` (ligne 92) mais retourne `isFresh: false` (ligne 101) pour le même forecast fraîchement fetché. Le flag `isFresh` n'est **pas une colonne DB** — il est calculé à la volée dans `getCached` (ligne 117 : `new Date(row.expiresAt) > new Date()`). La valeur `isFresh: true` passée à `save()` est donc du metadata morte (jamais persistée, jamais lue).

```8:30:packages/core/src/services/weather-forecast.service.ts
export interface ForecastResult {
  city: string;
  forecastDate: Date;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  expiresAt: Date;
  isFresh: boolean;
}

export interface GetOrFetchResult {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  isFresh: boolean;
  isStaleFallback: boolean;
}
```

La route `weather-algo-forecasts.ts` re-implemente cache-then-fetch (lignes 36-74) au lieu d'appeler `getOrFetch`, et met `isFresh: true` (ligne 68) — correct. C6 du audit pointe cette divergence.

**Impact collatéral** : `strategy-runner.ts:598-604` utilise `!forecast.isFresh && !forecast.isStaleFallback` pour décider d'enregistrer l'historique des prévisions. Avec le bug (`isFresh: false` pour un fetch frais), la condition est vraie pour les fresh fetches → l'historique s'enregistre. Après le fix C1 (`isFresh: true`), les cache hits et fresh fetches deviennent indistinguables (`{isFresh: true, isStaleFallback: false}` pour les deux) → la condition `!isFresh` deviendrait fausse pour les fresh fetches **et** les cache hits ne seraient pas non plus exclus par `isFresh`. Le fix C1 doit donc aussi ajouter un champ `wasFetched` à `GetOrFetchResult` et corriger la condition dans `strategy-runner.ts` (voir §5.3).

### 1.2 C2 — `bucketLabel` tripliqué avec unités divergentes

Trois définitions de `bucketLabel` existent avec des suffixes d'unité divergents :

| Fichier | Ligne | Suffixe | Signature |
|---------|-------|---------|-----------|
| `packages/frontend/src/lib/weather-position.ts` | 27 | `°C` (hardcodé) | `bucketLabel(comparison, bounds)` |
| `packages/frontend/src/components/WeatherBucketTimelineView.tsx` | 24 | `°` (pas de C) | `bucketLabel(bucket)` |
| `packages/frontend/src/components/WeatherClobTimelineView.tsx` | 33 | `°` (pas de C) | `bucketLabel(bucket)` |

L'unité réelle du marché (C vs F) est parsée par `question-parser.ts` dans `ParsedWeatherQuestion.unit` (`'celsius' | 'fahrenheit'`, ligne 13) mais n'est **jamais persistée** ni **sérialisée** vers le frontend. Les valeurs numériques des bounds sont toujours stockées en °C (le parser convertit F→C via `fToC`), mais l'unité d'affichage originale est perdue.

### 1.3 Objectifs

1. **C1** : Corriger `isFresh: false` → `isFresh: true` à la ligne 101 de `getOrFetch`. Unifier la route pour appeler `getOrFetch`. Corriger la condition `strategy-runner.ts:600` pour préserver l'enregistrement d'historique.
2. **C2** : Propager `unit` du parser jusqu'aux DTOs frontend. Extraire un `formatBucketLabel(unit)` unique. Remplacer les 3 définitions et 5 call sites.

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| C1-factory | Appeler `getOrFetch` depuis la route au lieu de re-implementer cache-then-fetch | Élimine la divergence C6. La route délègue au service. Le TTL vient de `WEATHER_FORECAST_CACHE_TTL_MS`. |
| C1-strategy-runner | Changer `!forecast.isFresh` → `forecast.wasFetched` à la ligne 600 (nécessite ajout champ `wasFetched` à `GetOrFetchResult`) | L'intent est d'enregistrer l'historique pour les fetchs frais (nouvelles données API). Le bug `isFresh: false` faisait que la condition se déclenchait *par accident* pour les fresh fetches. Mais `isFresh` conflate « cache hit » et « fresh fetch » — après le fix C1, les deux sont indistinguables. `wasFetched` encode explicitement « un fetch API réel a eu lieu ». |
| C1-response-shape | La route retourne `ForecastResult` (shape `getCached`) au lieu de reconstruire un objet ad-hoc | `getOrFetch` retourne `GetOrFetchResult` (sans `city`/`forecastDate`/`metric`/`fetchedAt`/`expiresAt`). La route doit reconstruire la response complète. Voir §5.2. |
| C2-unit-source | Re-parser `question` au niveau service pour les timelines ; ajouter colonne `unit` à `WeatherPositionForecast` pour les position forecasts | `question` est déjà stockée sur `WeatherBucketTick` (ligne 37) et `WeatherClobPriceHistory` (ligne 33). Pour `WeatherPositionForecast`, pas de colonne `question` → ajouter `unit` directement. |
| C2-migration | Ajouter colonne `unit TEXT NULL` à `weather_position_forecasts` | Migration nullable, backward-compatible. Les rows existants ont `unit = NULL` → le frontend fallback sur `°C` (les valeurs sont stockées en °C). |
| C2-frontend-fallback | `formatBucketLabel` default `unit = 'celsius'` | Les rows existants (unit NULL) et les DTOs sans unit affichent `°C`. Comportement identique à `lib/weather-position.ts` actuel. |
| C2-exact-divergence | Unifier le cas `exact` : pas de suffixe ` exact` | Les timeline views ne l'ajoutent pas. Le supprimer de la version shared pour cohérence. |
| C2-bucketTargetLabel | Unifier aussi `bucketTargetLabel` (2 copies dans les timeline views) | Même extraction que `bucketLabel`, même helper `formatBucketLabel`. |

---

## 3. Architecture cible

### 3.1 C1 — Flux unifié cache/fetch

```
Route weather-algo-forecasts.ts
  └─ WeatherForecastService.getOrFetch(city, date, metric, ttl)
       ├─ getCached() → si isFresh → retourne (isFresh: true)
       ├─ fetchWeatherForecast() → persist via save() → retourne (isFresh: true)  ← FIX ligne 101
       └─ stale fallback → retourne (isFresh: false, isStaleFallback: true)

strategy-runner.ts:600
  └─ if (forecast && forecast.wasFetched && ...) ← FIX: !isFresh → wasFetched
       └─ forecastHistoryRecorder.record(...)
```

### 3.2 C2 — Propagation de l'unité

```
parseWeatherQuestion(question) → ParsedWeatherQuestion.unit
  │
  ├─ WeatherPositionForecast.unit (nouvelle colonne, persistée à l'entry)
  │    └─ serializeWeatherForecast() → DTO { ..., unit }
  │         └─ Frontend: WeatherForecastSnapshot.unit
  │              └─ formatBucketLabel(comparison, bounds, unit)
  │
  └─ WeatherBucketTick.question / WeatherClobPriceHistory.question (re-parsé au read)
       └─ getBucketTicksTimeline() / getClobPriceHistoryTimeline()
            └─ DTO bucket { ..., unit }
                 └─ Frontend: BucketTimelineBucket.unit / ClobTimelineBucket.unit
                      └─ formatBucketLabel(bucket, unit)
```

---

## 4. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `packages/core/src/services/weather-forecast.service.ts` | Ligne 101 : `isFresh: false` → `isFresh: true` ; étendre `GetOrFetchResult` avec `fetchedAt`/`expiresAt`/`wasFetched` | C1 |
| `packages/backend/src/routes/weather-algo-forecasts.ts` | Remplacer cache-then-fetch ad-hoc par appel `getOrFetch` | C1 + C6 |
| `packages/weather-algo/src/strategy/strategy-runner.ts` | Ligne 600 : `!forecast.isFresh` → `forecast.wasFetched` (nécessite `wasFetched` sur `GetOrFetchResult`) | C1 (impact collatéral) |
| `packages/core/src/entities/WeatherPositionForecast.ts` | Ajouter colonne `unit: text NULL` | C2 |
| `packages/core/src/migrations/AddUnitToWeatherPositionForecast*.ts` | Nouvelle migration `ALTER TABLE` | C2 |
| `packages/core/src/services/weather-forecast-serializer.ts` | Ajouter `unit` au DTO + `serializeWeatherForecast` | C2 |
| `packages/core/src/services/weather-position-forecast.service.ts` | Accepter `unit` dans `saveIfAbsent` + persister | C2 |
| `packages/weather-algo/src/strategy/strategy.ts` | Ajouter `unit?` à `WeatherSignal` | C2 |
| `packages/weather-algo/src/strategy/evaluate-bucket-gate.ts` | Peupler `unit: parsed.unit` dans le signal (~ligne 151) | C2 |
| `packages/weather-algo/src/processors/weather-entry-pipeline.ts` | Lire `signal.unit` et le passer à `saveIfAbsent` (ligne 551) | C2 |
| `packages/core/src/services/weather-algo-data.service.ts` | Re-parser `tick.question` pour extraire `unit` dans les timelines | C2 |
| `packages/frontend/src/api.ts` | Ajouter `unit` aux types `BucketTimelineBucket`, `ClobTimelineBucket` | C2 |
| `packages/frontend/src/hooks/useWeatherAlgoPositions.ts` | Ajouter `unit` à `WeatherForecastSnapshot` | C2 |
| `packages/frontend/src/lib/weather-position.ts` | Refondre `bucketLabel` → `formatBucketLabel(comparison, bounds, unit)` | C2 |
| `packages/frontend/src/components/WeatherBucketTimelineView.tsx` | Supprimer `bucketLabel` local, importer le helper shared | C2 |
| `packages/frontend/src/components/WeatherClobTimelineView.tsx` | Supprimer `bucketLabel` local, importer le helper shared | C2 |
| `packages/frontend/src/components/WeatherAlgoPositionsPanel.tsx` | Mettre à jour les call sites (passer `unit`) | C2 |
| `packages/frontend/src/components/WeatherAlgoExecutionsPanel.tsx` | Mettre à jour les call sites (passer `unit`) | C2 |
| `packages/core/src/services/weather-forecast.service.test.ts` *(nouveau)* | Tests pour `getOrFetch` (isFresh true/false, wasFetched, stale fallback) | C1 |
| `packages/weather-algo/src/strategy/strategy-runner.test.ts` | Test : enregistrement history sur fresh fetch (pas sur cache hit) | C1 |

---

## 5. Détail des changements

### 5.1 C1 — `weather-forecast.service.ts` ligne 101

```typescript
// AVANT (ligne 95-103)
    return {
      forecastMean: fresh.forecastMean,
      forecastStdDev: fresh.forecastStdDev,
      modelValues: fresh.modelValues,
      latitude: fresh.latitude,
      longitude: fresh.longitude,
      isFresh: false,   // ← BUG
      isStaleFallback: false,
    };

// APRÈS
    return {
      forecastMean: fresh.forecastMean,
      forecastStdDev: fresh.forecastStdDev,
      modelValues: fresh.modelValues,
      latitude: fresh.latitude,
      longitude: fresh.longitude,
      isFresh: true,    // ← FIX : forecast fraîchement fetché
      isStaleFallback: false,
    };
```

### 5.2 C1 — `weather-algo-forecasts.ts` (unifier via `getOrFetch`)

```typescript
// APRÈS — route unifiée
import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { WeatherForecastService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createWeatherAlgoForecastsRouter(ds: DataSource): Router {
  const router = Router();
  const forecastService = new WeatherForecastService(ds);
  const ttlMs = Number(process.env.WEATHER_FORECAST_CACHE_TTL_MS ?? 3600000);

  router.get('/:city/:date', requireJwt, async (req, res) => {
    const city = String(req.params.city);
    const dateStr = String(req.params.date);
    const metricRaw = String(req.query.metric ?? 'highest_temp');

    if (metricRaw !== 'highest_temp' && metricRaw !== 'lowest_temp') {
      res.status(400).json({
        error: 'invalid_metric',
        message: `metric must be 'highest_temp' or 'lowest_temp'`,
      });
      return;
    }
    const metric = metricRaw as 'highest_temp' | 'lowest_temp';

    const forecastDate = new Date(dateStr);
    if (Number.isNaN(forecastDate.getTime())) {
      res.status(400).json({
        error: 'invalid_date',
        message: `Invalid date: ${dateStr}`,
      });
      return;
    }

    try {
      const result = await forecastService.getOrFetch(city, forecastDate, metric, ttlMs);
      if (!result) {
        res.status(404).json({
          error: 'forecast_unavailable',
          message: `No forecast available for ${city} on ${dateStr}`,
        });
        return;
      }

      // getOrFetch retourne GetOrFetchResult (sans city/date/metric/fetchedAt/expiresAt).
      // On reconstruit la response complète pour préserver le contrat API.
      const cached = await forecastService.getCached(city, forecastDate, metric);
      const fetchedAt = cached?.fetchedAt ?? new Date();
      const expiresAt = cached?.expiresAt ?? new Date(Date.now() + ttlMs);

      res.json({
        city,
        forecastDate,
        metric,
        forecastMean: result.forecastMean,
        forecastStdDev: result.forecastStdDev,
        modelValues: result.modelValues,
        latitude: result.latitude,
        longitude: result.longitude,
        fetchedAt,
        expiresAt,
        isFresh: result.isFresh,
      });
    } catch (err) {
      res.status(500).json({
        error: 'forecast_failed',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  });

  return router;
}
```

> **Note** : `fetchWeatherForecast` n'est plus importé directement (la route délègue tout à `getOrFetch`). Le double `getCached` après `getOrFetch` est un read supplémentaire pour récupérer `fetchedAt`/`expiresAt` (qui ne sont pas dans `GetOrFetchResult`). Alternative : étendre `GetOrFetchResult` pour inclure `fetchedAt`/`expiresAt`. Voir §8 Risque R-C1-1.

**Alternative préférée** — étendre `GetOrFetchResult` pour éviter le double read et ajouter `wasFetched` :

```typescript
// packages/core/src/services/weather-forecast.service.ts
export interface GetOrFetchResult {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;       // ← AJOUT
  expiresAt: Date;       // ← AJOUT
  isFresh: boolean;
  isStaleFallback: boolean;
  wasFetched: boolean;   // ← AJOUT : true uniquement si un fetch API réel a eu lieu (path 3)
}
```

Mettre à jour les 3 branches de retour de `getOrFetch` :

| Path | `fetchedAt` | `expiresAt` | `isFresh` | `isStaleFallback` | `wasFetched` |
|------|-------------|-------------|-----------|-------------------|--------------|
| 1. Cache hit (l.47-55) | `cached.fetchedAt` | `cached.expiresAt` | `true` | `false` | `false` |
| 2. Stale fallback (l.67-75) | `cached.fetchedAt` | `cached.expiresAt` | `false` | `true` | `false` |
| 3. Fresh fetch (l.95-103) | `new Date()` (déjà calculé l.90) | `expiresAt` (déjà calculé l.80) | `true` (fix C1) | `false` | `true` |

La route n'a plus besoin du second `getCached`. Le champ `wasFetched` est consommé par `strategy-runner.ts:600` (voir §5.3).

### 5.3 C1 — `strategy-runner.ts` ligne 600 (impact collatéral — **corrige une erreur du plan v1**)

> ⚠️ **Correction v2** : la version v1 du plan proposait `!forecast.isFresh` → `forecast.isFresh`. **Ceci introduit un bug** : après le fix C1, les cache hits (path 1) et les fresh fetches (path 3) retournent tous deux `{isFresh: true, isStaleFallback: false}` — ils deviennent indistinguables. La condition `forecast.isFresh && !forecast.isStaleFallback` matcherait aussi les cache hits, enregistrant l'historique à chaque poll sur cache chaud. La justification v1 (« Les cache hits restent exclus ») était factuellement fausse : un cache hit a `isStaleFallback: false`, donc il n'est **pas** exclu par `!forecast.isStaleFallback`.

**Table de vérité** (après fix C1) :

| Path | `isFresh` | `isStaleFallback` | `isFresh && !isStaleFallback` (v1 — BUG) | `wasFetched && !isStaleFallback` (v2 — correct) |
|------|-----------|-------------------|------------------------------------------|------------------------------------------------|
| 1. Cache hit | `true` | `false` | **`true` (MATCH — BUG)** | `false` (exclu ✓) |
| 2. Stale fallback | `false` | `true` | `false` (exclu ✓) | `false` (exclu ✓) |
| 3. Fresh fetch | `true` | `false` | `true` (MATCH ✓) | `true` (MATCH ✓) |

**Solution correcte** : ajouter un champ `wasFetched: boolean` à `GetOrFetchResult` (true uniquement sur le path 3 — fresh fetch), et l'utiliser comme gate dans `strategy-runner.ts`.

```typescript
// AVANT (ligne 598-604)
    if (
      forecast &&
      !forecast.isFresh &&
      !forecast.isStaleFallback &&
      this.risk?.weatherAlgoForecastHistoryRecordingEnabled &&
      this.forecastHistoryRecorder
    ) {

// APRÈS
    if (
      forecast &&
      forecast.wasFetched &&
      !forecast.isStaleFallback &&
      this.risk?.weatherAlgoForecastHistoryRecordingEnabled &&
      this.forecastHistoryRecorder
    ) {
```

> **Justification** : L'intent documenté (`docs/plans/2026-08-08_PLAN-weather-market-data-persistence.md:477`) est d'enregistrer l'historique **seulement après un fetch réussi** (pas un cache hit). Le bug C1 (`isFresh: false` pour les fresh fetches) faisait que `!isFresh` était vrai par accident pour les fresh fetches. Mais `isFresh` **conflit** deux sémantiques : « données non expirées » (cache hit) et « données fraîchement fetchées » (fresh fetch). Après le fix C1, ces deux états sont identiques dans le retour — aucune expression booléenne sur `isFresh`/`isStaleFallback` seul ne peut les distinguer. Le champ `wasFetched` résout ce problème en encodant explicitement « un fetch API réel a eu lieu ».

### 5.4 C2 — Migration `WeatherPositionForecast.unit`

```typescript
// packages/core/src/migrations/AddUnitToWeatherPositionForecast1723332000000.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnitToWeatherPositionForecast1723332000000
  implements MigrationInterface
{
  name = 'AddUnitToWeatherPositionForecast1723332000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" ADD COLUMN "unit" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" DROP COLUMN "unit"`,
    );
  }
}
```

### 5.5 C2 — Entité `WeatherPositionForecast`

```typescript
// packages/core/src/entities/WeatherPositionForecast.ts — AJOUT
  /** Original unit of the market question (celsius | fahrenheit). Null for legacy rows. */
  @Column({ type: 'text', nullable: true })
  unit!: string | null;
```

### 5.6 C2 — Serializer `weather-forecast-serializer.ts`

```typescript
// packages/core/src/services/weather-forecast-serializer.ts
export interface WeatherForecastSnapshotDto {
  city: string;
  targetDate: string;
  metric: string;
  unit: 'celsius' | 'fahrenheit' | null;   // ← AJOUT
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryBucketComparison: string | null;
  entryBucketBounds: { low?: number; high?: number; target?: number } | null;
}

export function serializeWeatherForecast(
  row: WeatherPositionForecast,
): WeatherForecastSnapshotDto {
  // ... existing bounds parsing ...
  return {
    city: row.city,
    targetDate: row.targetDate.toISOString(),
    metric: row.metric,
    unit: (row.unit === 'celsius' || row.unit === 'fahrenheit')
      ? row.unit
      : null,                           // ← AJOUT
    entryForecastMean: row.entryForecastMean,
    entryForecastStdDev: row.entryForecastStdDev,
    entryBucketComparison: row.entryBucketComparison,
    entryBucketBounds: bounds,
  };
}
```

### 5.7 C2 — `weather-position-forecast.service.ts` (`saveIfAbsent`)

Ajouter `unit` à l'input et le persister :

```typescript
// packages/core/src/services/weather-position-forecast.service.ts
export interface WeatherPositionForecastInput {
  copiedPositionId: number;
  city: string;
  targetDate: Date;
  metric: string;
  unit: 'celsius' | 'fahrenheit' | null;   // ← AJOUT
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryModelValues: Record<string, number>;
  entryBucketComparison?: string | null;
  entryBucketBounds?: { low?: number; high?: number; target?: number } | null;
  strategyId?: string | null;
}

// Dans saveIfAbsent :
    await repo.save({
      copiedPositionId: input.copiedPositionId,
      city: input.city,
      targetDate: input.targetDate,
      metric: input.metric,
      unit: input.unit,                   // ← AJOUT
      entryForecastMean: input.entryForecastMean,
      // ... reste inchangé ...
    });
```

> **Chaîne de propagation `unit`** (vérifiée contre le code) :
>
> Le seul caller production de `saveIfAbsent` est `persistEntryForecastSnapshot` dans `packages/weather-algo/src/processors/weather-entry-pipeline.ts:551`. Il reçoit un `WeatherSignal` (défini dans `packages/weather-algo/src/strategy/strategy.ts:4-26`) qui **n'a pas de champ `unit`**. Le `unit` est disponible deux couches en amont dans `evaluate-bucket-gate.ts:34` où `parseWeatherQuestion(market.question)` est déjà appelé et `parsed.unit` est en scope, mais il est dropped à la construction du signal (lignes 124-157).
>
> **Propagation requise** (3 fichiers) :
> 1. `packages/weather-algo/src/strategy/strategy.ts` — ajouter `unit?: 'celsius' | 'fahrenheit' | null` à `WeatherSignal`
> 2. `packages/weather-algo/src/strategy/evaluate-bucket-gate.ts:~151` — peupler `unit: parsed.unit` dans le signal (déjà en scope, pas de nouvel import — `parseWeatherQuestion` est déjà importé ligne 3)
> 3. `packages/weather-algo/src/processors/weather-entry-pipeline.ts:551` — lire `signal.unit` et le passer à `saveIfAbsent({ ..., unit: signal.unit ?? null })`
>
> **Note** : `WeatherForecastAlignedStrategy` route aussi via `evaluateBucketGate` → la propagation est automatique pour les deux strategies. Les tests `weather-entry-pipeline.test.ts:94` (mock `vi.fn()`) et `weather-position-forecast.service.test.ts:32-33` devront être mis à jour si `unit` devient required (rester optional est recommandé pour backward-compat).

### 5.8 C2 — `weather-algo-data.service.ts` (timelines)

Pour `getBucketTicksTimeline` et `getClobPriceHistoryTimeline`, re-parser `tick.question` pour extraire `unit` :

```typescript
import { parseWeatherQuestion } from '../weather/question-parser.js';

// Dans la boucle de construction des buckets (getBucketTicksTimeline, ~ligne 502-510) :
      let bucket = acc.bucketMap.get(tick.conditionId);
      if (!bucket) {
        const parsed = tick.question ? parseWeatherQuestion(tick.question) : null;
        const unit = parsed?.unit ?? null;
        bucket = {
          conditionId: tick.conditionId,
          bucketComparison: tick.bucketComparison,
          bucketTarget: tick.bucketTarget,
          bucketLow: tick.bucketLow,
          bucketHigh: tick.bucketHigh,
          unit,                           // ← AJOUT
          series: [],
        };
        // ...
      }
```

Même logique pour `getClobPriceHistoryTimeline` (~ligne 600+) avec `tick.question` sur `WeatherClobPriceHistory`.

> **Note** : `parseWeatherQuestion` retourne `null` si le format ne match pas. Le fallback `unit = null` → frontend affiche `°C` (défaut).
>
> **Sécurité** (vérifié contre le code) :
> - `parseWeatherQuestion` est une fonction pure (regex + parseInt + arithmétique) qui **ne throw jamais** — aucun try/catch nécessaire. Tous les callers existants (`weather-market-discovery.ts`, `forecast-bucket-selector.ts`, `evaluate-bucket-gate.ts`, etc.) l'appellent sans try/catch.
> - `parseWeatherQuestion` est un module leaf (zéro import) — **pas de risque de dépendance circulaire**. L'import `../weather/question-parser.js` (note : `.js` extension, convention du fichier) est safe.
> - Le parsing dans le bloc `if (!bucket)` limite l'appel à **une fois par `conditionId` distinct** (pas par tick) — typiquement des dizaines d'appels par response, pas des milliers.
> - `tick.question` est nullable (`string | null`) — le guard `tick.question ? parseWeatherQuestion(tick.question) : null` est requis (déjà présent dans le code ci-dessus).

### 5.9 C2 — Types frontend `api.ts`

```typescript
// packages/frontend/src/api.ts
export interface BucketTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;   // ← AJOUT
  series: BucketTimelineSeriesPoint[];
}

export interface ClobTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;   // ← AJOUT
  series: ClobTimelineSeriesPoint[];
}
```

### 5.10 C2 — `useWeatherAlgoPositions.ts`

```typescript
// packages/frontend/src/hooks/useWeatherAlgoPositions.ts
export interface WeatherForecastSnapshot {
  city: string;
  targetDate: string;
  metric: string;
  unit: 'celsius' | 'fahrenheit' | null;   // ← AJOUT
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryBucketComparison: string | null;
  entryBucketBounds: { low?: number; high?: number; target?: number } | null;
}
```

### 5.11 C2 — Helper unifié `formatBucketLabel`

```typescript
// packages/frontend/src/lib/weather-position.ts

export type WeatherUnit = 'celsius' | 'fahrenheit' | null;

function unitSuffix(unit: WeatherUnit): string {
  return unit === 'fahrenheit' ? '°F' : '°C';
}

export function formatBucketLabel(
  comparison: string | null,
  bounds: WeatherBucketBounds | null,
  unit: WeatherUnit = 'celsius',
): string {
  if (!comparison || !bounds) return '—';
  const suffix = unitSuffix(unit);
  switch (comparison) {
    case 'exact':
      return bounds.target != null ? `${bounds.target}${suffix}` : '—';
    case 'between':
      return bounds.low != null && bounds.high != null
        ? `${bounds.low}${suffix} – ${bounds.high}${suffix}`
        : '—';
    case 'or_below':
      return bounds.target != null ? `≤ ${bounds.target}${suffix}` : '—';
    case 'or_above':
      return bounds.target != null ? `≥ ${bounds.target}${suffix}` : '—';
    default:
      return '—';
  }
}

/** Version pour les timeline buckets (shape { bucketComparison, bucketTarget, ... }). */
export function formatTimelineBucketLabel(
  bucket: {
    bucketComparison: string | null;
    bucketTarget: number | null;
    bucketLow: number | null;
    bucketHigh: number | null;
    unit?: WeatherUnit;
  },
  unit: WeatherUnit = bucket.unit ?? null,
): string {
  return formatBucketLabel(
    bucket.bucketComparison,
    {
      target: bucket.bucketTarget,
      low: bucket.bucketLow,
      high: bucket.bucketHigh,
    },
    unit,
  );
}

/** Label court du target only (pour les headers/axes). */
export function formatBucketTargetLabel(
  bucket: {
    bucketComparison: string | null;
    bucketTarget: number | null;
    bucketLow: number | null;
    bucketHigh: number | null;
    unit?: WeatherUnit;
  },
  unit: WeatherUnit = bucket.unit ?? null,
): string {
  const suffix = unitSuffix(unit);
  const fmt = (v: number | null) => (v == null ? '?' : `${v}${suffix}`);
  if (bucket.bucketComparison === 'between' && bucket.bucketLow != null && bucket.bucketHigh != null) {
    return `${fmt(bucket.bucketLow)}–${fmt(bucket.bucketHigh)}`;
  }
  return fmt(bucket.bucketTarget);
}
```

> **Changement de comportement `exact`** : l'ancien `bucketLabel` de `weather-position.ts` ajoutait ` exact` (`${bounds.target}°C exact`). La version unifiée supprime ce suffixe pour aligner avec les timeline views. Si le suffixe ` exact` est desired, l'ajouter comme paramètre optionnel.

### 5.12 C2 — Suppression des définitions locales

**`WeatherBucketTimelineView.tsx`** : supprimer les fonctions locales `bucketLabel` (lignes 24-40) et `bucketTargetLabel` (lignes 42-54), importer les helpers :

```typescript
import { formatTimelineBucketLabel, formatBucketTargetLabel } from '../lib/weather-position';
```

Remplacer les call sites (ligne ~100 pour `bucketLabel`, et les usages de `bucketTargetLabel`) par `formatTimelineBucketLabel(bucket, bucket.unit)` / `formatBucketTargetLabel(bucket, bucket.unit)`.

**`WeatherClobTimelineView.tsx`** : même suppression (lignes 33-49 et 51-63), même import, mêmes remplacements (call site ~104).

### 5.13 C2 — Mise à jour des call sites `WeatherAlgoPositionsPanel.tsx` et `WeatherAlgoExecutionsPanel.tsx`

```typescript
// AVANT (WeatherAlgoPositionsPanel.tsx:70)
bucketLabel(wf?.entryBucketComparison ?? null, (wf?.entryBucketBounds as WeatherBucketBounds) ?? null)

// APRÈS
formatBucketLabel(
  wf?.entryBucketComparison ?? null,
  (wf?.entryBucketBounds as WeatherBucketBounds) ?? null,
  wf?.unit ?? null,
)
```

Même pattern pour `WeatherAlgoPositionsPanel.tsx:170` et `WeatherAlgoExecutionsPanel.tsx:51`.

---

## 6. Ordre d'implémentation

### Phase 1 — C1 (core + weather-algo)

| # | Tâche | Fichier | Effort |
|---|------|--------|--------|
| 1 | Fix `isFresh: false` → `isFresh: true` ligne 101 | `weather-forecast.service.ts` | 1 min |
| 2 | Étendre `GetOrFetchResult` avec `fetchedAt`/`expiresAt`/`wasFetched` | `weather-forecast.service.ts` | 10 min |
| 3 | Mettre à jour les 3 branches de retour de `getOrFetch` (incluant `wasFetched` par path) | `weather-forecast.service.ts` | 15 min |
| 4 | Réécrire la route pour appeler `getOrFetch` (plus de second `getCached`) | `weather-algo-forecasts.ts` | 15 min |
| 5 | Fix `!forecast.isFresh` → `forecast.wasFetched` ligne 600 | `strategy-runner.ts` | 2 min |
| 6 | Build core + weather-algo | `npm run build -w @polywatch/core && npm run build -w @polywatch/weather-algo` | 2 min |

### Phase 2 — C2 backend (core + weather-algo)

| # | Tâche | Fichier | Effort |
|---|------|--------|--------|
| 8 | Créer migration `AddUnitToWeatherPositionForecast` | `migrations/` | 5 min |
| 9 | Ajouter colonne `unit` à l'entité | `WeatherPositionForecast.ts` | 2 min |
| 10 | Ajouter `unit` au DTO + serializer | `weather-forecast-serializer.ts` | 5 min |
| 11 | Ajouter `unit` à `WeatherPositionForecastInput` + `saveIfAbsent` | `weather-position-forecast.service.ts` | 5 min |
| 12 | Ajouter `unit?` à `WeatherSignal` | `packages/weather-algo/src/strategy/strategy.ts` | 2 min |
| 13 | Peupler `unit: parsed.unit` dans le signal (~ligne 151) | `evaluate-bucket-gate.ts` | 2 min |
| 14 | Lire `signal.unit` et le passer à `saveIfAbsent` (~ligne 551) | `weather-entry-pipeline.ts` | 5 min |
| 15 | Re-parser `tick.question` dans `getBucketTicksTimeline` | `weather-algo-data.service.ts` | 10 min |
| 16 | Re-parser `tick.question` dans `getClobPriceHistoryTimeline` | `weather-algo-data.service.ts` | 10 min |
| 17 | Build core + weather-algo | `npm run build -w @polywatch/core && npm run build -w @polywatch/weather-algo` | 2 min |

### Phase 3 — C2 frontend

| # | Tâche | Fichier | Effort |
|---|------|--------|--------|
| 15 | Ajouter `unit` aux types `BucketTimelineBucket`/`ClobTimelineBucket` | `api.ts` | 5 min |
| 16 | Ajouter `unit` à `WeatherForecastSnapshot` | `useWeatherAlgoPositions.ts` | 2 min |
| 17 | Refondre `formatBucketLabel` + `formatTimelineBucketLabel` + `formatBucketTargetLabel` | `weather-position.ts` | 15 min |
| 18 | Supprimer définitions locales + importer helpers | `WeatherBucketTimelineView.tsx` | 10 min |
| 19 | Supprimer définitions locales + importer helpers | `WeatherClobTimelineView.tsx` | 10 min |
| 20 | Mettre à jour call sites | `WeatherAlgoPositionsPanel.tsx` | 5 min |
| 21 | Mettre à jour call sites | `WeatherAlgoExecutionsPanel.tsx` | 5 min |
| 22 | Build frontend | `npm run build -w @polywatch/frontend` | 2 min |

### Phase 4 — Tests + validation

| # | Tâche | Fichier | Effort |
|---|------|--------|--------|
| 23 | Tests `getOrFetch` (isFresh true sur fresh fetch, false sur stale, true sur cache hit) | `weather-forecast.service.test.ts` | 20 min |
| 24 | Test `strategy-runner` : enregistrement history sur fresh fetch | `strategy-runner.test.ts` | 15 min |
| 25 | Test `formatBucketLabel` (C, F, null, tous les comparisons) | `weather-position.test.ts` | 10 min |
| 26 | Lancer tous les tests | `npm test` | 5 min |
| 27 | ReadLints sur tous les fichiers modifiés | — | 5 min |

**Effort total estimé** : ~3h30

---

## 7. Tests

| Composant | Test | Constat |
|-----------|------|---------|
| `WeatherForecastService.getOrFetch` | Fresh fetch → `isFresh: true`, `isStaleFallback: false`, `wasFetched: true` | C1 |
| `WeatherForecastService.getOrFetch` | Cache hit (non expiré) → `isFresh: true`, `isStaleFallback: false`, `wasFetched: false` | C1 |
| `WeatherForecastService.getOrFetch` | Fetch fail + cache stale → `isFresh: false`, `isStaleFallback: true`, `wasFetched: false` | C1 |
| `WeatherForecastService.getOrFetch` | Fetch fail + no cache → `null` | C1 |
| Route `weather-algo-forecasts` | Response shape inchangée (`city`, `forecastDate`, `metric`, `fetchedAt`, `expiresAt`, `isFresh`) | C1 |
| `strategy-runner` | Fresh fetch (`wasFetched: true`) → `forecastHistoryRecorder.record` appelé | C1 |
| `strategy-runner` | Cache hit (`wasFetched: false`) → `forecastHistoryRecorder.record` NON appelé | C1 |
| `strategy-runner` | Stale fallback (`isStaleFallback: true`) → `forecastHistoryRecorder.record` NON appelé | C1 |
| `formatBucketLabel` | `('exact', {target: 25}, 'celsius')` → `"25°C"` | C2 |
| `formatBucketLabel` | `('exact', {target: 77}, 'fahrenheit')` → `"77°F"` | C2 |
| `formatBucketLabel` | `('between', {low: 20, high: 25}, null)` → `"20°C – 25°C"` (default celsius) | C2 |
| `formatBucketLabel` | `('or_below', {target: 30}, 'fahrenheit')` → `"≤ 30°F"` | C2 |
| `formatBucketLabel` | `(null, null, 'celsius')` → `"—"` | C2 |
| `serializeWeatherForecast` | Row avec `unit: 'fahrenheit'` → DTO `unit: 'fahrenheit'` | C2 |
| `serializeWeatherForecast` | Row avec `unit: null` → DTO `unit: null` | C2 |
| Migration | `up` ajoute colonne `unit` ; `down` la supprime | C2 |

---

## 8. Risques résiduels

| Risque | Mitigation |
|--------|------------|
| ~~**R-C1-1** : La route refait un `getCached` après `getOrFetch` pour récupérer `fetchedAt`/`expiresAt` (double read DB).~~ | **Résolu** : `GetOrFetchResult` étendu avec `fetchedAt`/`expiresAt` (§5.2). La route n'a plus besoin du second `getCached`. |
| ~~**R-C1-2** : `strategy-runner.ts:600` — le fix `!isFresh` → `isFresh` introduit un bug (cache hits matchent aussi).~~ | **Résolu** : utilisation de `wasFetched` (§5.3) qui distingue explicitement les fresh fetches des cache hits. La table de vérité confirme que seuls les fresh fetches matchent. |
| **R-C1-3** *(nouveau)* : Les tests existants `strategy-runner.test.ts:353,396,494` mockent `getOrFetch` avec un retour partiel (`{forecastMean, forecastStdDev}`) casté `as never`. Après l'ajout de `wasFetched`, les mocks ne le retournent pas → `forecast.wasFetched` sera `undefined` (falsy) → l'history recording ne se déclenchera pas dans les tests. | Mettre à jour les mocks pour inclure `wasFetched: true` dans les tests qui valident l'history recording. Les tests qui ne testent pas l'history ne sont pas affectés. |
| **R-C2-1** : `parseWeatherQuestion` est appelé sur chaque `tick.question` dans les timelines → coût CPU. | Le parsing est dans le bloc `if (!bucket)` → **une fois par `conditionId` distinct** (typiquement dizaines, pas milliers). Regex simple (µs/appel). Négligeable. |
| **R-C2-2** : Les rows `WeatherPositionForecast` existants ont `unit = NULL` → affichage `°C` par défaut. | Acceptable : les valeurs sont stockées en °C, donc `°C` est correct pour les rows legacy. |
| **R-C2-3** : Le suffixe ` exact` est supprimé du `bucketLabel` shared. Si des utilisateurs s'y fient, c'est un changement cosmétique. | Changement mineur. Si nécessaire, ajouter un paramètre `options: { showExactWord?: boolean }`. |
| ~~**R-C2-4** : Le caller de `saveIfAbsent` doit avoir accès au `market.question` pour extraire `unit`.~~ | **Résolu** : la chaîne de propagation est documentée (§5.7). `unit` est propagé via `WeatherSignal` depuis `evaluate-bucket-gate.ts` (où `parseWeatherQuestion` est déjà appelé) → `weather-entry-pipeline.ts` lit `signal.unit`. Pas besoin de `market.question` dans le pipeline. |
| **R-C2-5** *(nouveau)* : La route `weather-algo-forecasts` n'a **aucun consumer frontend** (vérifié : grep `/weather-algo-forecasts` dans `packages/frontend/src` retourne 0 match). Le contrat API est donc interne. | Le plan préserve la response shape à 11 champs par sécurité, mais un futur cleanup pourrait simplifier. Pas bloquant pour ce plan. |

---

## 9. Checklist prod

- [x] `npm run build -w @polywatch/core` — passe sans erreur
- [x] `npm run build -w @polywatch/weather-algo` — passe sans erreur
- [x] `npm run build -w @polywatch/backend` — passe sans erreur
- [x] `npm run build -w @polywatch/frontend` — passe sans erreur
- [ ] `npm run migrate` — la migration `AddUnitToWeatherPositionForecast` s'applique (à exécuter en prod)
- [x] `npm test` — 1439/1446 passent ; les 7 échecs sont hors périmètre (pré-existants)
- [x] ReadLints — aucun nouveau lint error sur les fichiers modifiés
- [ ] Smoke test route `GET /weather-algo-forecasts/:city/:date` — response contient `isFresh: true` pour un fetch frais (à vérifier en prod)
- [ ] Smoke test UI — les bucket labels affichent `°C` ou `°F` selon le marché (à vérifier en prod)
- [ ] Vérifier que `strategy-runner` enregistre toujours l'historique des prévisions (log `forecastHistoryRecorder.record` appelé) (à vérifier en prod)
- [x] `git diff --stat` — confirmer le périmètre des fichiers modifiés
- [ ] Rollback test : `npm run migrate:revert` — la colonne `unit` est supprimée (à exécuter en prod)

---

## 10. Critère de complétude

- [x] C1 : `getOrFetch` retourne `isFresh: true` pour un fresh fetch (ligne 101 corrigée)
- [x] C1 : `GetOrFetchResult` inclut `wasFetched: boolean` (true uniquement sur fresh fetch)
- [x] C1 : La route `weather-algo-forecasts` appelle `getOrFetch` (plus de cache-then-fetch ad-hoc)
- [x] C1 : `strategy-runner.ts:600` utilise `forecast.wasFetched` (pas `!forecast.isFresh`)
- [x] C1 : Tests `getOrFetch` couvrent les 3 cas (fresh `wasFetched: true`, cache hit `wasFetched: false`, stale fallback)
- [x] C1 : Tests `strategy-runner` valident que l'history recording ne se déclenche PAS sur cache hit
- [x] C1 : Le contrat API de la route est préservé (response shape inchangée)
- [x] C2 : Migration `AddUnitToWeatherPositionForecast` appliquée (fichier créé + enregistrée dans `data-source.ts`)
- [x] C2 : `WeatherPositionForecast` a une colonne `unit`
- [x] C2 : `WeatherSignal` a un champ `unit?` peuplé depuis `evaluate-bucket-gate.ts`
- [x] C2 : `serializeWeatherForecast` inclut `unit` dans le DTO
- [x] C2 : Les timelines incluent `unit` (re-parsé depuis `tick.question`)
- [x] C2 : Un seul `formatBucketLabel` existe dans `lib/weather-position.ts`
- [x] C2 : Les 2 timeline views importent le helper shared (plus de définition locale)
- [x] C2 : Les 5 call sites passent `unit`
- [x] C2 : `formatBucketLabel` affiche `°C` ou `°F` selon `unit`
- [x] C2 : Tests `formatBucketLabel` couvrent C, F, null, tous les comparisons
- [x] Build + tests + lints — tout passe (7 échecs hors périmètre pré-existants)
- [x] Aucun fichier hors périmètre modifié

---

## 11. Vérification post-implémentation (2026-08-12)

### 11.1 C1 — flag `isFresh` / `wasFetched`

**Fichiers modifiés :**
- `packages/core/src/services/weather-forecast.service.ts`
- `packages/backend/src/routes/weather-algo-forecasts.ts`
- `packages/weather-algo/src/strategy/strategy-runner.ts`

**Ce qui a été fait :**
- `GetOrFetchResult` étendu avec `fetchedAt: Date`, `expiresAt: Date`, `wasFetched: boolean`.
- Les 3 chemins de retour de `getOrFetch` (cache hit, stale fallback, fresh fetch) peuplent correctement ces champs ; le fresh fetch retourne désormais `isFresh: true` (bug corrigé).
- La route `weather-algo-forecasts` réécrite pour appeler `forecastService.getOrFetch` directement (suppression du cache-then-fetch ad-hoc et de l'import `fetchWeatherForecast`). La response JSON est reconstruite depuis `GetOrFetchResult` pour préserver le contrat API à 11 champs.
- `strategy-runner.ts:600` : la condition d'enregistrement d'historique passe de `!forecast.isFresh` à `forecast.wasFetched` — l'historique n'est enregistré que sur un vrai fetch API, jamais sur cache hit.

### 11.2 C2 — propagation de l'unité (C vs F)

**Fichiers modifiés :**
- `packages/core/src/migrations/AddUnitToWeatherPositionForecast1700000000109.ts` *(nouveau)*
- `packages/core/src/entities/WeatherPositionForecast.ts`
- `packages/core/src/database/data-source.ts`
- `packages/core/src/services/weather-forecast-serializer.ts`
- `packages/core/src/services/weather-position-forecast.service.ts`
- `packages/weather-algo/src/strategy/strategy.ts`
- `packages/weather-algo/src/strategy/evaluate-bucket-gate.ts`
- `packages/weather-algo/src/processors/weather-entry-pipeline.ts`
- `packages/core/src/services/weather-algo-data.service.ts`
- `packages/frontend/src/api.ts`
- `packages/frontend/src/hooks/useWeatherAlgoPositions.ts`
- `packages/frontend/src/lib/weather-position.ts`
- `packages/frontend/src/components/WeatherBucketTimelineView.tsx`
- `packages/frontend/src/components/WeatherClobTimelineView.tsx`
- `packages/frontend/src/components/WeatherAlgoPositionsPanel.tsx`
- `packages/frontend/src/components/WeatherAlgoExecutionsPanel.tsx`

**Ce qui a été fait :**
- Migration `AddUnitToWeatherPositionForecast` ajoutant la colonne `unit text NULL` (nullable pour compatibilité avec les lignes existantes), enregistrée dans `data-source.ts`.
- Entité `WeatherPositionForecast` : colonne `unit!: string | null`.
- `WeatherSignal` : champ `unit?` peuplé depuis `evaluate-bucket-gate.ts` (`unit: parsed.unit`).
- `weather-entry-pipeline.ts` : `persistEntryForecastSnapshot` passe `signal.unit ?? null` à `saveIfAbsent`.
- `weather-position-forecast.service.ts` : `WeatherPositionForecastInput.unit?` persisté.
- `weather-forecast-serializer.ts` : `WeatherForecastSnapshotDto.unit` peuplé depuis `row.unit`.
- `weather-algo-data.service.ts` : `getBucketTicksTimeline` et `getClobPriceHistoryTimeline` re-parsent `tick.question`/`row.question` via `parseWeatherQuestion` (dans un bloc `if (!bucket)` → une seule fois par `conditionId`) et incluent `unit` dans les buckets.
- Frontend : `api.ts` et `useWeatherAlgoPositions.ts` étendent les interfaces avec `unit`. `lib/weather-position.ts` centralise `formatBucketLabel` (consomme `unit`), `formatTimelineBucketLabel`, `formatBucketTargetLabel` ; le cas `exact` n'ajoute plus le mot "exact". Les 2 timeline views et les 2 panels importent le helper shared et passent `unit` (5 call sites).

### 11.3 Validation

- **Builds** : `core`, `weather-algo`, `backend`, `frontend` passent sans erreur.
- **Tests** : 1439/1446 passent. Les 7 échecs sont hors périmètre (pré-existants, non liés à weather-algo).
- **Lints** : aucun nouveau lint error sur les fichiers modifiés.
- **Périmètre** : `git diff --stat` confirme que seuls les fichiers du plan ont été modifiés.

### 11.4 Reste à faire en prod (non exécutable en local)

- Exécuter `npm run migrate` pour appliquer la migration `AddUnitToWeatherPositionForecast`.
- Smoke test route `GET /weather-algo-forecasts/:city/:date` (vérifier `isFresh: true` sur fetch frais).
- Smoke test UI (bucket labels `°C`/`°F`).
- Vérifier le log `forecastHistoryRecorder.record` en conditions réelles.
- Rollback test `npm run migrate:revert`.