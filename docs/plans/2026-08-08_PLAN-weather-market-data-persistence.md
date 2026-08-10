# Plan v4 — Persistance données marché weather (buckets par ville suivie)

**Date** : 2026-08-08 (v4 corrigée revue code)
**Statut** : **Phases 0–4 implémentées** (2026-08-08) + UI onglet **Données** (cards / drill-down / purge) ; **Phase 5 implémentée** (2026-08-09) — moteur `@polywatch/backtest` + onglet **Backtest** dans Weather Algo (voir `[../backtest.md](../backtest.md)`) ; patch fidélité audit `[applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md](applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)` (`0.2.0`). Warnings quantitatifs §12.2 **non livrés**.
**Doc d’implémentation** : `[applied/2026-08-08_IMPL-weather-market-data-persistence.md](./applied/2026-08-08_IMPL-weather-market-data-persistence.md)`
**Scope** : Enregistrer les données marché (prix buckets) + forecasts versionnés pour backtester les stratégies weather
**Référence backtest** : `[2026-08-05_PLAN-backtest-engine-universel.md](./2026-08-05_PLAN-backtest-engine-universel.md)` §1.3 et Phase 0.3
**Référence audit** : `[2026-08-08_audit-weather-forecast-strategy.md](../strategies-audit/2026-08-08_audit-weather-forecast-strategy.md)`
**Référence spec multi-stratégies** : `[2026-08-08_SPEC_multi-strategy-weather-algo.md](../strategies-audit/2026-08-08_SPEC_multi-strategy-weather-algo.md)`

### Objectif final (clarification)

À chaque cycle d’évaluation du `WeatherStrategyRunner` (période = `weatherAlgoPollMs`, défaut **30 min**), pour chaque **ville suivie** (règle auto-track enabled) × date look-ahead :

1. Persister un **snapshot marché** + les **prix YES/NO de chaque bucket actif**
2. Persister un **forecast versionné** seulement si un fetch Open-Meteo réel a eu lieu (pas cache hit, pas stalez)
3. Persister le **journal d’évaluation** (signal / abstain + edge / seuil) par bucket × stratégie

Ces données alimentent le backtest weather (Phase 5 — **implémentée**, voir `[../backtest.md](../backtest.md)`). **UI livrée** : toggles / rétention dans **Paramètres** + onglet **Données** (exploration / purge) + onglet **Backtest** dans Weather Algo (lancement de runs, métriques, equity).

---

## 0. Corrections vs v1 (18 bugs/fantômes + corrections v4)

### v2 — 12 corrections (revue 1)


| #   | Bug v1                                                                    | Fix v2                                                                                                   | Décision                  |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | Purge dans mauvais process (backend inexistant)                           | Purge dans `weather-algo` (process propriétaire)                                                         | Choix utilisateur         |
| 2   | `result.forecastProb`/`edge` n'existent pas sur `abstain` → compile error | Étendre `WeatherEvaluationResult` avec `forecastProb`, `edge`, `dynamicMinEdge` sur les 2 variants       | Choix utilisateur         |
| 3   | `noPrice` approximation `1 - yes` fausse pour arbitrage                   | Lire vrai `outcomePrices[1]`, `null` si absent + warning                                                 | Fix technique             |
| 4   | Recorders toggles non atomiques → orphelins                               | 3 toggles indépendants + guard cohérence (eval ⇒ snapshot)                                               | Choix utilisateur (split) |
| 5   | `forecast_history` enregistré aussi par les exits                         | Enregistrer dans le runner, pas dans `getOrFetch`                                                        | Fix technique             |
| 6   | `dynamicMinEdge` non exposé par la stratégie → donnée fausse              | Étendre `WeatherEvaluationResult` (même fix que #2)                                                      | Choix utilisateur         |
| 7   | Pas de FK/CASCADE pour bucket_ticks                                       | FK `snapshot_id` + `ON DELETE CASCADE`                                                                   | Choix utilisateur         |
| 8   | `rule.id` non passé à `evaluateCityFollowDateGroup`                       | Ajouter paramètre `ruleId` à la méthode                                                                  | Fix technique             |
| 9   | I/O synchrone (N inserts individuels)                                     | Batch les `evaluation_log` en 1 INSERT + `await` (sûr)                                                   | Choix utilisateur         |
| 10  | Forecast snapshot vs history décalé                                       | Backtest utilise `forecast_mean` du snapshot (déjà prévu) ; `forecast_history` pour révisions uniquement | Fix technique             |
| 11  | Buckets inactifs exclus → Σ arbitrage faux                                | Enregistrer seulement les buckets actifs + warning fidélité backtest                                     | Choix utilisateur         |
| 12  | Ordre `outcomePrices` non garanti YES/NO                                  | Résoudre via `outcomes[]` (side 0 = YES, side 1 = NO)                                                    | Fix technique             |


### v3 — 6 corrections (revue 2)


| #   | Bug v2                                                                                 | Fix v3                                                                                                                           | Type    |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R1  | `resolveBucketPrices` duplique un helper core                                          | Utiliser les helpers **réels** `binaryPricesFromParsed` + `binaryPricesToUpDown` (noms v3 erronés)                               | Bug     |
| R2  | `getOrFetch` ne retourne pas modelValues/lat/lon → forecast_history incomplet          | Étendre retour de `getOrFetch` à `GetOrFetchResult` ; vérifier appelants (safe)                                                  | Bug     |
| R3  | `dynamicMinEdge` parsé depuis `reasons[]` (fragile) pour les signals                   | Étendre `WeatherSignal` avec `dynamicMinEdge: number` ; renseigner dans la stratégie                                             | Bug     |
| R4  | Tests existants cassent (signature + recorders manquants)                              | Recorders optionnels + null-check ; `buildRunner` (test) fonctionne sans recorders ; MAJ signature `evaluateCityFollowDateGroup` | Bug     |
| Z1  | Stale fallback non détecté → forecast_history enregistre un forecast non rafraîchi     | Flag `isStaleFallback` dans `getOrFetch` ; ne pas enregistrer forecast_history si stale                                          | Fantôme |
| Z2  | Snapshot non enregistré sur retour anticipé (forecast null, 0 buckets) → gaps backtest | Enregistrer snapshot (même vide / forecast null) **avant** les guards de retour                                                  | Fantôme |


### v4 — corrections revue code (2026-08-08)


| #    | Bug / lacune v3                                                                          | Fix v4                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| V4-1 | Noms fantômes `resolveSide0Side1Prices` / `mapSidePricesToUpDown`                        | Utiliser `binaryPricesFromParsed` + `binaryPricesToUpDown` (`outcome-tokens.ts`, exportés via `@polywatch/core`)            |
| V4-2 | Purge conditionnée aux toggles recording → stockage infini si toggles OFF après collecte | Purger **toujours** selon les jours de rétention (recorder présent), indépendamment des toggles d’écriture                  |
| V4-3 | Z2 incomplet : `if (!forecast) return null` actuel est avant collecte                    | Ordre imposé : fetch → collecte → snapshot → **puis** `if (!forecast || activeBuckets.length === 0) return null` → evaluate |
| V4-4 | Plumbing config/API omis (Zod `.strict()`, `data-source`, exports)                       | Checklist obligatoire Phase 0 / 3 (voir §14)                                                                                |
| V4-5 | Perf / volume basés sur `pollMs = 15s`                                                   | Recalculés sur défaut réel `weatherAlgoPollMs = 1_800_000` (30 min)                                                         |
| V4-6 | Phase 5 suppose `packages/backtest` (inexistant)                                         | Phase 5 **hors scope** de ce plan ; différée au plan backtest universel                                                     |
| V4-7 | Diagramme FK `forecast_history ← snapshots` incorrect                                    | Corrige : seule FK = `bucket_ticks`/`evaluation_log` → `snapshots`                                                          |
| V4-8 | Risque `forecast_mean = 0` répété 6× dans §16                                            | Une seule ligne                                                                                                             |


---

## 1. Contexte et problème

### 1.1 État actuel des données weather


| Donnée                               | Persistance                                      | Granularité              | Suffisant pour backtest ?                           |
| ------------------------------------ | ------------------------------------------------ | ------------------------ | --------------------------------------------------- |
| Forecast (mean, std, model_values)   | `weather_forecast_cache` — **upsert destructif** | par (city, date, metric) | **Non** — pas d'historique de révisions             |
| Snapshot forecast à l'entrée         | `weather_position_forecasts`                     | 1/position               | Partiel — seulement si position ouverte             |
| Prix marché (tous buckets)           | **Non persisté**                                 | —                        | **Non** — discovery stateless, prix live uniquement |
| Prix marché (bucket sélectionné)     | `market_position_ticks` — 500 ms                 | si position ouverte      | Partiel — uniquement après entrée                   |
| Prix marché (fallback horaire)       | `market_price_ticks`                             | mid horaire              | Partiel — pas de BBO, pas tous les buckets          |
| Snapshot discovery (marchés trouvés) | **Non persisté**                                 | —                        | **Non** — stateless                                 |


### 1.2 Objectifs du plan

1. **Persister les forecasts versionnés** — append-only, à chaque refresh
2. **Persister les snapshots de marché** par ville suivie — buckets actifs, à chaque cycle d'évaluation
3. **Persister les ticks de prix par bucket** — prix YES/NO de chaque bucket actif, à chaque poll
4. **Persister les évaluations** — edge calculé, seuil dynamique, décision (signal/abstain), raison
5. **Consommation par le backtest** — `WeatherDataLoader` lit ces tables pour rejouer les évaluations

---

## 2. Process propriétaire et responsabilité

### 2.1 Dans quel process s'exécute la persistance

Le weather-algo est un **process standalone** (`packages/weather-algo/src/index.ts`), distinct du backend et du worker :

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  weather-algo   │     │     worker      │     │    backend      │
│  (process)      │     │   (process)     │     │   (process)     │
│                 │     │                 │     │                 │
│ • StrategyRunner│     │ • Executor      │     │ • API REST      │
│ • ExitEvaluator │     │ • MarketTick    │     │ • Config CRUD   │
│ • RECORDERS ←NEW│     │   Recorder      │     │ • Routes lecture│
│ • PURGE ←NEW    │     │ • Purge ticks   │     │                 │
│   (hourly)      │     │   (hourly)      │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └─────────── PostgreSQL (shared) ────────────────┘
```

**Recording** : dans le process `weather-algo` (le `StrategyRunner` écrit pendant ses cycles).
**Purge** : dans le process `weather-algo` (process propriétaire des nouvelles tables), via un `safeInterval` horaire ajouté à `packages/weather-algo/src/index.ts` — calqué sur le pattern du worker (`packages/worker/src/index.ts` L422-438).
**Lecture (API)** : dans le process `backend` (routes REST).

### 2.2 Raison du choix

- Le weather-algo est le seul process qui exécute les cycles d'évaluation → il est le seul à avoir accès aux buckets et aux résultats de stratégie au bon moment.
- Le worker n'a pas accès à `WeatherConfig` (rétention configurable) → purge déplacée vers le weather-algo.
- Le backend expose déjà l'API REST → routes de lecture ajoutées là.

---

## 3. Architecture cible

```
WeatherStrategyRunner.runEvaluationCycle()
         │
         ├─ 1. discoverWeatherMarkets() → temperatureMarkets (live)
         │
         ├─ 2. forecastService.getOrFetch(city, date, metric)
         │       (cache hit → pas d'enregistrement ; cache miss → fetch + enregistrement history)
         │
         ├─ 3. Pour chaque ville suivie (rule):
         │       └─ groupMarketsByCityAndDate → buckets[]
         │       └─ filtre isMarketActiveForWeather → activeBuckets[]
         │
         ├─ 4. [SI weatherAlgoMarketSnapshotRecordingEnabled]
         │       WeatherMarketSnapshotRecorder.recordSnapshot()
         │       └─► INSERT weather_market_snapshots (1 snapshot/ville/date/poll)
         │       └─► INSERT weather_bucket_ticks (N activeBuckets par snapshot, en transaction)
         │
         ├─ 5. strategy.evaluate(bucket, ctx) pour chaque bucket
         │       └─► collecte des résultats (signal + abstain) avec forecastProb/edge/threshold
         │
         └─ 6. [SI weatherAlgoEvaluationLogRecordingEnabled]
         │       WeatherEvaluationRecorder.recordBatch()
         │       └─► 1 INSERT weather_evaluation_log (batch de toutes les evals du cycle)
         │
         7. Signal → entry pipeline (existant)
```

**Guard de cohérence** : si `evaluationLogRecording` est ON mais `marketSnapshotRecording` est OFF, le runner logge un warning et force `snapshotId = null` dans les eval_logs (pas de crash). Réciproquement, si `forecastHistoryRecording` est OFF, aucune `forecast_history` n'est écrite (indépendant des autres).

---

## 4. Extension des interfaces (fix bugs #2, #6, R3)

Avant tout, étendre le type `WeatherEvaluationResult` pour exposer `forecastProb`, `edge` et `dynamicMinEdge` sur les deux variants. Sans cela, le runner ne peut pas logger ces valeurs.

```typescript
// packages/weather-algo/src/strategy/strategy.ts
export type WeatherEvaluationResult =
  | {
      kind: 'signal';
      signal: WeatherSignal;
      // Déjà disponibles via signal.forecastProbability / signal.edge / signal.dynamicMinEdge
    }
  | {
      kind: 'abstain';
      reason: string;
      detail?: string;
      forecastProb?: number;   // probabilité forecast calculée (si disponible)
      edge?: number;           // edge brut (forecastProb - yesPrice, si disponible)
      dynamicMinEdge?: number; // seuil dynamique appliqué (si disponible)
    };
```

**Extension de `WeatherSignal`** (fix R3 — pas de parsing de `reasons[]`) :

```typescript
export interface WeatherSignal {
  // ... champs existants ...
  forecastProbability: number;
  marketPrice: number;
  edge: number;
  dynamicMinEdge: number;   // NOUVEAU — seuil dynamique appliqué (déjà calculé par la stratégie)
  entryBucketComparison?: ...;
  entryBucketBounds?: ...;
}
```

**Modification de `WeatherForecastStrategy.evaluate`** : chaque `return { kind: 'abstain', ... }` doit inclure `forecastProb`, `edge`, `dynamicMinEdge` quand ils sont calculés. Le signal doit aussi renseigner `dynamicMinEdge`. Cas :

- `no_question` / `unrecognized_question` : aucun calcul → `undefined`
- `zero_forecast_probability` : `forecastProb = 0`, `edge` et `dynamicMinEdge` non calculés → `undefined`
- `forecast_probability_below_min` : `forecastProb` calculé, `edge` non calculé encore, `dynamicMinEdge` non calculé → `forecastProb` seulement
- `forecast_too_uncertain` : `forecastProb` et `edge` calculés, `dynamicMinEdge` calculé → les 3
- `no_market_prices` / `zero_prices` : `forecastProb` calculé, `edge` non (pas de prix), `dynamicMinEdge` non → `forecastProb` seulement
- `insufficient_edge` : `forecastProb`, `edge`, `dynamicMinEdge` tous calculés → les 3
- `missing_token` : `forecastProb`, `edge`, `dynamicMinEdge` tous calculés → les 3

**Impact** : les stratégies futures (`weather-spread`, `weather-convergence`, `weather-arbitrage`) doivent aussi exposer ces champs sur leurs `abstain` et renseigner `dynamicMinEdge` sur leur signal. À documenter dans la spec multi-stratégies.

---

## 5. Résolution YES/NO (fix bug #12, R1, V4-1)

Ne pas se fier à l'ordre de `outcomePrices[]`. **Utiliser les utilitaires existants** `binaryPricesFromParsed` + `binaryPricesToUpDown` de `@polywatch/core` (`packages/core/src/polymarket/outcome-tokens.ts`) qui résolvent déjà side0/side1 via alias labels ("Yes"/"No"/"Up"/"Down" insensibles à la casse) avec fallback sur l'index. **Ne pas créer un second helper de résolution** — seulement un wrapper mince nommé `resolveBucketPrices`.

> **Note v4** : les noms `resolveSide0Side1Prices` / `mapSidePricesToUpDown` du plan v3 **n'existent pas** dans le codebase.

```typescript
// packages/weather-algo/src/strategy/runner-bucket-helpers.ts (nouveau, wrapper mince)
import { binaryPricesFromParsed, binaryPricesToUpDown, type MarketListItemDto } from '@polywatch/core';

export interface ResolvedBucketPrices {
  yesPrice: number | null;   // prix YES (side0 = upPrice)
  noPrice: number | null;     // prix NO (side1 = downPrice)
  yesTokenId: string | null;
  noTokenId: string | null;
}

/**
 * Résout les prix YES/NO via binaryPricesFromParsed + binaryPricesToUpDown.
 * Ne réinvente pas la résolution — réutilise la source de vérité unique.
 */
export function resolveBucketPrices(market: MarketListItemDto): ResolvedBucketPrices {
  const sidePrices = binaryPricesFromParsed(market.outcomePrices ?? []);
  const upDown = binaryPricesToUpDown(sidePrices);
  return {
    yesPrice: upDown.upPrice,    // side0 = YES
    noPrice: upDown.downPrice,   // side1 = NO
    yesTokenId: market.tokenIdYes,
    noTokenId: market.tokenIdNo,
  };
}
```

**Règle** : `noPrice` est `null` si absent (pas d'approximation `1 - yes`). L'`evaluation_log` et `bucket_ticks` stockent `null`. Le backtest et la stratégie `weather-arbitrage` doivent gérer le `null` (ignorer le bucket pour le calcul de Σ).

---

## 6. Nouvelles tables

### 6.1 `weather_forecast_history` (append-only)

```sql
CREATE TABLE weather_forecast_history (
  id            SERIAL PRIMARY KEY,
  city          TEXT NOT NULL,
  forecast_date TIMESTAMP NOT NULL,
  metric        TEXT NOT NULL,
  forecast_mean REAL NOT NULL,
  forecast_std_dev REAL NOT NULL,
  model_values_json TEXT NOT NULL,        -- {"gfs":31,"ecmwf":30,"icon":32}
  latitude      REAL NOT NULL,
  longitude     REAL NOT NULL,
  fetched_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wfh_city_date_metric ON weather_forecast_history (city, forecast_date, metric, fetched_at);
CREATE INDEX idx_wfh_fetched_at ON weather_forecast_history (fetched_at);
```

**Entité TypeORM** : `packages/core/src/entities/WeatherForecastHistory.ts`

```typescript
@Entity('weather_forecast_history')
@Index(['city', 'forecastDate', 'metric', 'fetchedAt'])
@Index(['fetchedAt'])
export class WeatherForecastHistory {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'text' }) city!: string;
  @Column({ type: 'timestamp', name: 'forecast_date' }) forecastDate!: Date;
  @Column({ type: 'text' }) metric!: string;
  @Column({ type: 'real', name: 'forecast_mean' }) forecastMean!: number;
  @Column({ type: 'real', name: 'forecast_std_dev' }) forecastStdDev!: number;
  @Column({ type: 'text', name: 'model_values_json' }) modelValuesJson!: string;
  @Column({ type: 'real' }) latitude!: number;
  @Column({ type: 'real' }) longitude!: number;
  @Column({ type: 'timestamp', name: 'fetched_at' }) fetchedAt!: Date;
}
```

**Rétention** : 90 jours. **Volume indicatif** (défaut poll 30 min, ~10 villes × 3 dates, TTL forecast 1 h) : ~quelques dizaines à ~quelques centaines de lignes/jour (surtout cache hits) → ordre de grandeur **≪ 26k/90j**.

### 6.2 `weather_market_snapshots` (snapshot par ville/date/poll)

```sql
CREATE TABLE weather_market_snapshots (
  id            SERIAL PRIMARY KEY,
  city          TEXT NOT NULL,
  city_normalized TEXT NOT NULL,
  target_date_iso TEXT NOT NULL,
  metric        TEXT NOT NULL,
  forecast_mean REAL,                      -- forecast au moment du snapshot (NULL si indisponible)
  forecast_std_dev REAL,                   -- NULL si indisponible
  bucket_count  INTEGER NOT NULL,         -- nombre de buckets actifs enregistrés
  total_bucket_count INTEGER NOT NULL,   -- nombre total de buckets trouvés (actifs + exclus)
  rule_id       INTEGER,
  recorded_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wms_city_date_recorded ON weather_market_snapshots (city_normalized, target_date_iso, recorded_at);
CREATE INDEX idx_wms_recorded_at ON weather_market_snapshots (recorded_at);
```

**Note vs v1** : ajout de `total_bucket_count` pour que le backtest sache combien de buckets ont été exclus (warning fidélité si `total_bucket_count > bucket_count`).

**Entité TypeORM** : `packages/core/src/entities/WeatherMarketSnapshot.ts`

**Rétention** : 30 jours. **Volume indicatif** au défaut 30 min : ~1 440/jour → ~43k/30j (échelle avec `pollMs` et nb de villes).

### 6.3 `weather_bucket_ticks` (prix par bucket actif)

```sql
CREATE TABLE weather_bucket_ticks (
  id                SERIAL PRIMARY KEY,
  snapshot_id       INTEGER NOT NULL REFERENCES weather_market_snapshots(id) ON DELETE CASCADE,
  city              TEXT,                  -- dénormalisé depuis le snapshot parent
  city_normalized   TEXT,                  -- dénormalisé depuis le snapshot parent
  target_date_iso   TEXT,                  -- dénormalisé depuis le snapshot parent
  metric            TEXT,                  -- dénormalisé depuis le snapshot parent
  fidelity_minutes  INTEGER,               -- dérivé de weatherAlgoPollMs (cadence de snapshot)
  condition_id      TEXT NOT NULL,
  event_slug        TEXT,
  question          TEXT,
  bucket_comparison TEXT,
  bucket_target     REAL,
  bucket_low        REAL,
  bucket_high       REAL,
  yes_price         REAL,                  -- NULL si indisponible (pas d'approximation)
  no_price          REAL,                  -- NULL si indisponible
  yes_token_id      TEXT,
  no_token_id       TEXT,
  volume            REAL,
  volume_24hr       REAL,
  liquidity_clob    REAL,
  accepting_orders  BOOLEAN,
  closed            BOOLEAN,
  end_date          TIMESTAMP,
  recorded_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wbt_snapshot_id ON weather_bucket_ticks (snapshot_id);
CREATE INDEX idx_wbt_condition_id_recorded ON weather_bucket_ticks (condition_id, recorded_at);
CREATE INDEX idx_wbt_recorded_at ON weather_bucket_ticks (recorded_at);
CREATE INDEX idx_wbt_city_date_recorded ON weather_bucket_ticks (city_normalized, target_date_iso, recorded_at);
```

**Fix vs v1** :

- `yes_price` et `no_price` sont **nullable** (REAL sans NOT NULL) — pas d'approximation si absent.
- FK `snapshot_id` avec `ON DELETE CASCADE` (fix bug #7) — la suppression d'un snapshot supprime automatiquement ses bucket_ticks.
- Seuls les buckets **actifs** sont enregistrés (fix #11, choix utilisateur).

**Entité TypeORM** : `packages/core/src/entities/WeatherBucketTick.ts`

**Rétention** : 30 jours (cascade via FK). **Volume** : proportionnel à `snapshots × buckets actifs` ; au défaut typique ~10k–20k/jour selon nb de buckets, pas ~23k forcé à 15s.

### 6.4 `weather_evaluation_log` (décisions de l'algo)

```sql
CREATE TABLE weather_evaluation_log (
  id                SERIAL PRIMARY KEY,
  snapshot_id       INTEGER REFERENCES weather_market_snapshots(id) ON DELETE SET NULL,
  condition_id      TEXT NOT NULL,
  bucket_comparison TEXT,
  bucket_target     REAL,
  bucket_low        REAL,
  bucket_high       REAL,
  strategy_id       TEXT NOT NULL,
  yes_price         REAL,                 -- NULL si indisponible
  forecast_prob     REAL,                 -- NULL sur abstain précoce (no_question, etc.)
  edge              REAL,                 -- NULL si non calculé
  dynamic_min_edge  REAL,                 -- NULL si non calculé
  decision          TEXT NOT NULL,        -- signal | abstain
  reason            TEXT,                 -- raison si abstain
  evaluated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wel_snapshot_id ON weather_evaluation_log (snapshot_id);
CREATE INDEX idx_wel_condition_id ON weather_evaluation_log (condition_id, evaluated_at);
CREATE INDEX idx_wel_strategy_id ON weather_evaluation_log (strategy_id, evaluated_at);
CREATE INDEX idx_wel_evaluated_at ON weather_evaluation_log (evaluated_at);
```

**Fix vs v1** :

- `snapshot_id` est une FK avec `ON DELETE SET NULL` (pas CASCADE) — les eval_logs survivent à la purge des snapshots (90j vs 30j), avec `snapshot_id = null`.
- `forecast_prob`, `edge`, `dynamic_min_edge` sont **nullable** (peuvent être absents sur abstain précoce).
- `yes_price` nullable (peut être absent si `no_market_prices`).

**Entité TypeORM** : `packages/core/src/entities/WeatherEvaluationLog.ts`

**Rétention** : 90 jours. **Volume** : même ordre que bucket_ticks × stratégies évaluées ; rétention plus longue que les snapshots (`snapshot_id` peut devenir null après purge 30j).

---

## 7. Configuration — 3 toggles indépendants

Choix utilisateur : 3 toggles séparés au lieu d'un seul, pour pouvoir activer les forecasts seuls (très léger) sans les snapshots (plus lourd).


| Colonne                                           | Type    | Défaut     | Rôle                                                                    |
| ------------------------------------------------- | ------- | ---------- | ----------------------------------------------------------------------- |
| `weather_algo_forecast_history_recording_enabled` | boolean | `**true**` | Active l'enregistrement `weather_forecast_history`                      |
| `weather_algo_market_snapshot_recording_enabled`  | boolean | `**true**` | Active `weather_market_snapshots` + `weather_bucket_ticks`              |
| `weather_algo_evaluation_log_recording_enabled`   | boolean | `**true**` | Active `weather_evaluation_log`                                         |
| `weather_algo_forecast_history_retention_days`    | integer | `90`       | Rétention `weather_forecast_history`                                    |
| `weather_algo_market_snapshot_retention_days`     | integer | `30`       | Rétention `weather_market_snapshots` + `weather_bucket_ticks` (cascade) |
| `weather_algo_evaluation_log_retention_days`      | integer | `90`       | Rétention `weather_evaluation_log`                                      |


### Guard de cohérence (fix bug #4)

Le runner applique cette règle à chaque cycle :

```
SI evaluationLogRecordingEnabled ET NON marketSnapshotRecordingEnabled:
    → log.warn("evaluation_log actif sans market_snapshot — snapshotId sera null")
    → continue (pas de crash, eval_logs orphelins avec snapshotId null)

SI evaluationLogRecordingEnabled ET marketSnapshotRecordingEnabled:
    → OK, snapshotId disponible pour les eval_logs

SI forecastHistoryRecordingEnabled seul:
    → OK, indépendant
```

**Rationale** : l'utilisateur a demandé des toggles séparés, mais on documente l'incohérence potentielle et on la gère gracieusement (warning + null, pas de crash).

---

## 8. Services de persistance

### 8.1 `WeatherForecastHistoryRecorder`

**Fichier** : `packages/core/src/services/weather-forecast-history-recorder.ts`

```typescript
export class WeatherForecastHistoryRecorder {
  constructor(private ds: DataSource) {}

  async record(input: {
    city: string;
    forecastDate: Date;
    metric: string;
    forecastMean: number;
    forecastStdDev: number;
    modelValues: Record<string, number>;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    await this.ds.getRepository(WeatherForecastHistory).insert({
      ...input,
      modelValuesJson: JSON.stringify(input.modelValues),
      fetchedAt: new Date(),
    });
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    // Pattern batch 5 000 lignes, calqué sur MarketPositionTickService.purgeOlderThan
  }
}
```

**Intégration (fix bug #5)** : enregistrer dans le **runner** (pas dans `getOrFetch`), seulement après un **fetch réussi** (pas un cache hit). Le runner sait qu'il est dans un cycle d'entrée, pas d'exit.

### 8.2 `WeatherMarketSnapshotRecorder`

**Fichier** : `packages/core/src/services/weather-market-snapshot-recorder.ts`

```typescript
export interface BucketTickInput {
  conditionId: string;
  eventSlug: string | null;
  question: string | null;
  bucketComparison: string;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  yesPrice: number | null;   // NULL si indisponible
  noPrice: number | null;   // NULL si indisponible
  yesTokenId: string | null;
  noTokenId: string | null;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  acceptingOrders: boolean | null;
  closed: boolean;
  endDate: Date | null;
}

export class WeatherMarketSnapshotRecorder {
  constructor(private ds: DataSource) {}

  async recordSnapshot(input: {
    city: string;
    cityNormalized: string;
    targetDateIso: string;
    metric: string;
    forecastMean: number | null;        // fix Z2 : null si forecast indisponible
    forecastStdDev: number | null;     // fix Z2 : null-safe
    buckets: BucketTickInput[];        // buckets actifs seulement
    totalBucketCount: number;          // actifs + exclus (pour warning fidélité)
    ruleId: number | null;
  }): Promise<{ snapshotId: number }> {
    // Transaction : INSERT snapshot + bulk INSERT bucket_ticks
    // Retourne snapshotId pour lier les eval_logs
    return await this.ds.transaction(async (em) => {
      const snapshot = await em.getRepository(WeatherMarketSnapshot).save({
        city: input.city,
        cityNormalized: input.cityNormalized,
        targetDateIso: input.targetDateIso,
        metric: input.metric,
        forecastMean: input.forecastMean,
        forecastStdDev: input.forecastStdDev,
        bucketCount: input.buckets.length,
        totalBucketCount: input.totalBucketCount,
        ruleId: input.ruleId,
      });
      if (input.buckets.length > 0) {
        await em.getRepository(WeatherBucketTick).insert(
          input.buckets.map((b) => ({ ...b, snapshotId: snapshot.id })),
        );
      }
      return { snapshotId: snapshot.id };
    });
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    // DELETE snapshots anciens — bucket_ticks supprimés en cascade par la FK
    const cutoff = new Date(Date.now() - retentionMs);
    const result = await this.ds.getRepository(WeatherMarketSnapshot)
      .createQueryBuilder()
      .delete()
      .where('recorded_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
```

### 8.3 `WeatherEvaluationRecorder` (batch)

**Fichier** : `packages/core/src/services/weather-evaluation-recorder.ts`

```typescript
export interface EvaluationLogInput {
  snapshotId: number | null;
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  strategyId: string;
  yesPrice: number | null;
  forecastProb: number | null;
  edge: number | null;
  dynamicMinEdge: number | null;
  decision: 'signal' | 'abstain';
  reason: string | null;
}

export class WeatherEvaluationRecorder {
  constructor(private ds: DataSource) {}

  /** Batch insert — 1 INSERT pour toutes les évaluations d'un cycle (fix bug #9). */
  async recordBatch(inputs: EvaluationLogInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.ds.getRepository(WeatherEvaluationLog).insert(
      inputs.map((input) => ({ ...input, evaluatedAt: new Date() })),
    );
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    // Pattern batch 5 000 lignes
  }
}
```

**Fix bug #9** : 1 seul `INSERT ... VALUES (...), (...), ...` pour toutes les évaluations d'un cycle, au lieu de N inserts individuels. L'utilisateur a choisi `batch + await` (sûr mais lent) — le batch réduit le coût à 1 round-trip BDD au lieu de N.

---

## 9. Intégration dans le runner

### 9.1 Injection des recorders

```typescript
// packages/weather-algo/src/strategy/strategy-runner.ts
export interface StrategyRunnerParams {
  // ... existant ...
  forecastHistoryRecorder?: WeatherForecastHistoryRecorder;
  marketSnapshotRecorder?: WeatherMarketSnapshotRecorder;
  evaluationRecorder?: WeatherEvaluationRecorder;
}
```

Les recorders sont instanciés dans `packages/weather-algo/src/index.ts` et passés au runner. Le runner lit les toggles dans `this.risk` (rechargé à chaque `config-changed`).

### 9.2 Points d'injection dans `runEvaluationCycle`

**Fix bug #8** : ajouter un paramètre `ruleId: number` à `evaluateCityFollowDateGroup` (passé depuis `evaluateCityFollowRules` qui a déjà `rule.id`).

**Fix Z2** : le snapshot doit être enregistré **avant** les guards de retour anticipé (forecast null, 0 buckets actifs). On enregistre un snapshot « vide » (0 buckets) pour tracer que la ville/date a été évaluée sans résultat — sinon le backtest voit des gaps et ne sait pas si la ville n'a pas été évaluée ou si l'algo a abstenu.

**Restructuration nécessaire (première étape)** : séparer collecte et filtrage dans `evaluateCityFollowDateGroup` :

```typescript
// Avant (actuel) : filtrage dans la boucle
const buckets: BucketCandidate[] = [];
for (const market of markets) {
  if (!isMarketActiveForWeather(market, minHoursToClose)) continue;  // filtré ici
  // ...
  buckets.push({ conditionId, market, parsed });
}
if (buckets.length === 0) return null;  // retour anticipé

// Après (v3) : séparer collecte et filtrage
const allBuckets: BucketCandidate[] = [];
for (const market of markets) {
  if (!market.question) continue;
  const parsed = parseWeatherQuestion(market.question);
  this.onParseResult?.(parsed != null);
  if (!parsed) continue;
  allBuckets.push({ conditionId: market.conditionId, market, parsed });
}
const totalBucketCount = allBuckets.length;
const activeBuckets = allBuckets.filter((b) => isMarketActiveForWeather(b.market, minHoursToClose));
// NE PAS retourner null ici — continuer vers le snapshot (fix Z2)
```

**Point 0 — Forecast fetch** (fix R2, Z1) :

Le runner ne peut pas distinguer cache hit vs fetch réussi vs stale fallback avec l'API actuelle (`getOrFetch` retourne `{ forecastMean, forecastStdDev }`).

**Étendre `WeatherForecastService.getOrFetch`** (fix R2) pour retourner un type complet :

```typescript
// packages/core/src/services/weather-forecast.service.ts
export interface GetOrFetchResult {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;   // NOUVEAU (fix R2)
  latitude: number;                       // NOUVEAU
  longitude: number;                      // NOUVEAU
  isFresh: boolean;                       // NOUVEAU — true si cache hit
  isStaleFallback: boolean;               // NOUVEAU (fix Z1) — true si fetch échoué, retour cache stale
}

async getOrFetch(city, forecastDate, metric, ttlMs): Promise<GetOrFetchResult | null> {
  const cached = await this.getCached(city, forecastDate, metric);
  if (cached?.isFresh) {
    return {
      forecastMean: cached.forecastMean,
      forecastStdDev: cached.forecastStdDev,
      modelValues: cached.modelValues,
      latitude: cached.latitude,
      longitude: cached.longitude,
      isFresh: true,
      isStaleFallback: false,
    };
  }
  const fresh = await fetchWeatherForecast(city, forecastDate, metric);
  if (!fresh) {
    if (cached) {
      return {
        forecastMean: cached.forecastMean,
        forecastStdDev: cached.forecastStdDev,
        modelValues: cached.modelValues,
        latitude: cached.latitude,
        longitude: cached.longitude,
        isFresh: false,
        isStaleFallback: true,   // fetch échoué, retour stale
      };
    }
    return null;
  }
  await this.save({ ...fresh, fetchedAt: new Date(), expiresAt: new Date(Date.now() + ttlMs), isFresh: true });
  return {
    forecastMean: fresh.forecastMean,
    forecastStdDev: fresh.forecastStdDev,
    modelValues: fresh.modelValues,
    latitude: fresh.latitude,
    longitude: fresh.longitude,
    isFresh: false,          // pas un cache hit (fetch réel)
    isStaleFallback: false, // fetch réussi
  };
}
```

**Audit appelants** (fix R2) : `WeatherExitEvaluator` et `runWeatherEntryPipeline` utilisent `getOrFetch` mais ne déstructurent que `forecastMean`/`forecastStdDev` → l'extension à `GetOrFetchResult` est rétro-compatible (sur-type, pas de cassage). Vérifier à l'implémentation que TypeScript n'alerte pas.

**Point 1 — Forecast history** (dans `evaluateCityFollowDateGroup`, après `getOrFetch`) :

```typescript
const forecast = await this.forecastService.getOrFetch(city, targetDate, metric, ttl);

// ── Ordre imposé (fix Z2 + V4-3) ──────────────────────────────────────
// 1. getOrFetch (ci-dessus)
// 2. collecte allBuckets / activeBuckets (déjà faite)
// 3. forecast_history (si fetch réel)
// 4. market snapshot (même si forecast null OU 0 buckets actifs)
// 5. GUARDS : if (!forecast || activeBuckets.length === 0) return null
// 6. strategy.evaluate + evaluation_log batch
// Ne JAMAIS return null pour forecast avant l'étape 4.

// Forecast history : seulement si fetch réel réussi (pas cache hit, pas stale fallback)
if (
  forecast &&
  !forecast.isFresh &&
  !forecast.isStaleFallback &&
  this.risk?.weatherAlgoForecastHistoryRecordingEnabled &&
  this.forecastHistoryRecorder
) {
  try {
    await this.forecastHistoryRecorder.record({
      city, forecastDate: targetDate, metric,
      forecastMean: forecast.forecastMean,
      forecastStdDev: forecast.forecastStdDev,
      modelValues: forecast.modelValues,   // fix R2 : disponible maintenant
      latitude: forecast.latitude,
      longitude: forecast.longitude,
    });
  } catch (err) {
    log.warn({ err, city, targetDate }, 'forecast history record failed — continuing');
  }
}
```

**Point 2 — Snapshot marché** (fix Z2 / V4-3 : avant les guards de retour, après collecte/filtrage) :

```typescript
let snapshotId: number | null = null;

// Fix Z2 : enregistrer le snapshot même si 0 buckets actifs ou forecast null
if (this.risk?.weatherAlgoMarketSnapshotRecordingEnabled && this.marketSnapshotRecorder) {
  const bucketInputs: BucketTickInput[] = activeBuckets.map((b) => {
    const prices = resolveBucketPrices(b.market);  // fix #12 + R1/V4-1
    return {
      conditionId: b.market.conditionId,
      eventSlug: b.market.eventSlug,
      question: b.market.question,
      bucketComparison: b.parsed.comparison,
      bucketTarget: b.parsed.targetValue,
      bucketLow: b.parsed.targetValueLow,
      bucketHigh: b.parsed.targetValueHigh,
      yesPrice: prices.yesPrice,   // NULL si absent
      noPrice: prices.noPrice,      // NULL si absent (pas d'approximation)
      yesTokenId: prices.yesTokenId,
      noTokenId: prices.noTokenId,
      volume: b.market.volume,
      volume24hr: b.market.volume24hr,
      liquidityClob: b.market.liquidityClob,
      acceptingOrders: b.market.acceptingOrders,
      closed: b.market.closed,
      endDate: b.market.endDate ? new Date(b.market.endDate) : null,
    };
  });

  try {
    const result = await this.marketSnapshotRecorder.recordSnapshot({
      city,
      cityNormalized: normalizeWeatherCity(city),
      targetDateIso: dateKey,
      metric,
      forecastMean: forecast?.forecastMean ?? null,      // null si indisponible (0°C reste une vraie valeur)
      forecastStdDev: forecast?.forecastStdDev ?? null,
      buckets: bucketInputs,                            // peut être vide (0 buckets actifs)
      totalBucketCount,
      ruleId,  // fix bug #8
    });
    snapshotId = result.snapshotId;
  } catch (err) {
    log.warn({ err, city, dateKey }, 'market snapshot record failed — continuing without snapshot');
    snapshotId = null;
  }
}

// Guards de retour anticipé (APRÈS snapshot — fix Z2 / V4-3)
if (!forecast) {
  log.warn({ city, dateKey, metric }, 'city-follow: forecast unavailable — skipping evaluate');
  return null;  // snapshot déjà enregistré (forecast_mean null) si toggle ON
}
if (activeBuckets.length === 0) {
  log.debug({ city, dateKey, marketCount: markets.length }, 'city-follow: no active markets');
  return null;  // snapshot vide déjà enregistré ci-dessus
}
```

**Point 3 — Évaluation + batch log** (fix R3 : `dynamicMinEdge` depuis `WeatherSignal.dynamicMinEdge`, pas parsing) :

```typescript
const evaluationInputs: EvaluationLogInput[] = [];
const candidates: WeatherSignal[] = [];

for (const bucket of activeBuckets) {
  for (const strategy of strategies) {
    const result = await strategy.evaluate(bucket.market, ctx);

    // Collecter pour batch (fix bug #9)
    if (this.risk?.weatherAlgoEvaluationLogRecordingEnabled && this.evaluationRecorder) {
      const prices = resolveBucketPrices(bucket.market);
      evaluationInputs.push({
        snapshotId,
        conditionId: bucket.conditionId,
        bucketComparison: bucket.parsed.comparison,
        bucketTarget: bucket.parsed.targetValue,
        bucketLow: bucket.parsed.targetValueLow,
        bucketHigh: bucket.parsed.targetValueHigh,
        strategyId: strategy.id,
        yesPrice: prices.yesPrice,
        forecastProb: result.kind === 'signal'
          ? result.signal.forecastProbability
          : result.forecastProb ?? null,        // fix bug #2
        edge: result.kind === 'signal'
          ? result.signal.edge
          : result.edge ?? null,                // fix bug #2
        dynamicMinEdge: result.kind === 'signal'
          ? result.signal.dynamicMinEdge         // fix R3 : champ dédié, pas parsing reasons[]
          : result.dynamicMinEdge ?? null,       // fix bug #6
        decision: result.kind === 'signal' ? 'signal' : 'abstain',
        reason: result.kind === 'abstain' ? result.reason : null,
      });
    }

    if (result.kind === 'signal') {
      candidates.push(result.signal);
      break;
    }
  }
}

// Batch insert (1 INSERT pour tout le cycle)
if (this.risk?.weatherAlgoEvaluationLogRecordingEnabled && this.evaluationRecorder && evaluationInputs.length > 0) {
  try {
    await this.evaluationRecorder.recordBatch(evaluationInputs);
  } catch (err) {
    log.warn({ err, city, dateKey }, 'evaluation log batch failed — continuing');
  }
}
```

**Fix R3 (rappel)** : `WeatherSignal.dynamicMinEdge` est renseigné par `WeatherForecastStrategy.evaluate` (déjà calculé à L119 via `resolveDynamicMinEdge`). Pas de parsing de `reasons[]`.

### 9.3 Gestion des erreurs (anti-bug-fantôme)

Tous les `await recorder.*` sont wrappés dans `try/catch` avec `log.warn`. Une erreur de recording **n'interrompt jamais** le cycle d'évaluation. Le runner continue sans snapshot (snapshotId = null) ou sans eval_log. C'est le principe « recording est best-effort, le trading est prioritaire ».

**Null-safety** : tous les guards utilisent `this.risk?.` (optional chaining) car `this.risk` peut être `null` au boot avant le premier `setRiskConfig`. Les recorders sont optionnels (`?:`) — si non passés au constructeur, ils sont `undefined` et les guards `if (this.recorder && ...)` court-circuitent.

---

## 10. Purge horaire dans le weather-algo

**Fix bug #1** : la purge s'exécute dans le process `weather-algo`, pas le backend ni le worker.

**Fix V4-2** : purger **selon la rétention**, dès que le recorder est instancié — **pas** conditionné aux toggles d’écriture. Sinon, désactiver le recording après accumulation laisse les tables grossir sans limite.

Ajouter à `packages/weather-algo/src/index.ts` (après `strategyRunner.start()`) :

```typescript
// Purge horaire des tables de données backtest (rétention, indépendant des toggles recording)
const dataPurgeTimer = safeInterval(
  async () => {
    const cfg = await weatherConfigService.getConfig();  // recharger config (rétention configurable)
    try {
      if (forecastHistoryRecorder) {
        const retentionMs = cfg.weatherAlgoForecastHistoryRetentionDays * 86_400_000;
        const deleted = await forecastHistoryRecorder.purgeOlderThan(retentionMs);
        if (deleted > 0) log.info({ deleted }, 'purged weather_forecast_history');
      }
      if (marketSnapshotRecorder) {
        const retentionMs = cfg.weatherAlgoMarketSnapshotRetentionDays * 86_400_000;
        const deleted = await marketSnapshotRecorder.purgeOlderThan(retentionMs);
        // bucket_ticks supprimés en cascade par la FK (fix bug #7)
        if (deleted > 0) log.info({ deleted }, 'purged weather_market_snapshots (cascade bucket_ticks)');
      }
      if (evaluationRecorder) {
        const retentionMs = cfg.weatherAlgoEvaluationLogRetentionDays * 86_400_000;
        const deleted = await evaluationRecorder.purgeOlderThan(retentionMs);
        if (deleted > 0) log.info({ deleted }, 'purged weather_evaluation_log');
      }
    } catch (err) {
      log.error({ err }, 'weather data purge failed');
    }
  },
  60 * 60 * 1000,  // horaire
  'weather-algo:data-purge',
);
```

Ne pas oublier `clearInterval(dataPurgeTimer)` dans le `shutdown`.

---

## 11. Migration TypeORM

```typescript
// packages/core/src/migrations/AddWeatherMarketDataPersistence1700000000100.ts
export class AddWeatherMarketDataPersistence1700000000100 implements MigrationInterface {
  name = 'AddWeatherMarketDataPersistence1700000000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. weather_forecast_history
    await queryRunner.query(`
      CREATE TABLE weather_forecast_history (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        forecast_date TIMESTAMP NOT NULL,
        metric TEXT NOT NULL,
        forecast_mean REAL NOT NULL,
        forecast_std_dev REAL NOT NULL,
        model_values_json TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_wfh_city_date_metric ON weather_forecast_history (city, forecast_date, metric, fetched_at)`);
    await queryRunner.query(`CREATE INDEX idx_wfh_fetched_at ON weather_forecast_history (fetched_at)`);

    // 2. weather_market_snapshots
    await queryRunner.query(`
      CREATE TABLE weather_market_snapshots (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        city_normalized TEXT NOT NULL,
        target_date_iso TEXT NOT NULL,
        metric TEXT NOT NULL,
        forecast_mean REAL,                      -- nullable (fix Z2 : null si forecast indisponible)
        forecast_std_dev REAL,                   -- nullable
        bucket_count INTEGER NOT NULL,
        total_bucket_count INTEGER NOT NULL,
        rule_id INTEGER,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_wms_city_date_recorded ON weather_market_snapshots (city_normalized, target_date_iso, recorded_at)`);
    await queryRunner.query(`CREATE INDEX idx_wms_recorded_at ON weather_market_snapshots (recorded_at)`);

    // 3. weather_bucket_ticks (avec FK CASCADE — fix bug #7)
    await queryRunner.query(`
      CREATE TABLE weather_bucket_ticks (
        id SERIAL PRIMARY KEY,
        snapshot_id INTEGER NOT NULL REFERENCES weather_market_snapshots(id) ON DELETE CASCADE,
        condition_id TEXT NOT NULL,
        event_slug TEXT,
        question TEXT,
        bucket_comparison TEXT,
        bucket_target REAL,
        bucket_low REAL,
        bucket_high REAL,
        yes_price REAL,
        no_price REAL,
        yes_token_id TEXT,
        no_token_id TEXT,
        volume REAL,
        volume_24hr REAL,
        liquidity_clob REAL,
        accepting_orders BOOLEAN,
        closed BOOLEAN,
        end_date TIMESTAMP,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_wbt_snapshot_id ON weather_bucket_ticks (snapshot_id)`);
    await queryRunner.query(`CREATE INDEX idx_wbt_condition_id_recorded ON weather_bucket_ticks (condition_id, recorded_at)`);
    await queryRunner.query(`CREATE INDEX idx_wbt_recorded_at ON weather_bucket_ticks (recorded_at)`);

    // 4. weather_evaluation_log (FK snapshot_id ON DELETE SET NULL)
    await queryRunner.query(`
      CREATE TABLE weather_evaluation_log (
        id SERIAL PRIMARY KEY,
        snapshot_id INTEGER REFERENCES weather_market_snapshots(id) ON DELETE SET NULL,
        condition_id TEXT NOT NULL,
        bucket_comparison TEXT,
        bucket_target REAL,
        bucket_low REAL,
        bucket_high REAL,
        strategy_id TEXT NOT NULL,
        yes_price REAL,
        forecast_prob REAL,
        edge REAL,
        dynamic_min_edge REAL,
        decision TEXT NOT NULL,
        reason TEXT,
        evaluated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_wel_snapshot_id ON weather_evaluation_log (snapshot_id)`);
    await queryRunner.query(`CREATE INDEX idx_wel_condition_id ON weather_evaluation_log (condition_id, evaluated_at)`);
    await queryRunner.query(`CREATE INDEX idx_wel_strategy_id ON weather_evaluation_log (strategy_id, evaluated_at)`);
    await queryRunner.query(`CREATE INDEX idx_wel_evaluated_at ON weather_evaluation_log (evaluated_at)`);

    // 5. Config columns — 3 toggles + 3 rétentions (choix utilisateur split)
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_forecast_history_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_market_snapshot_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_config ADD COLUMN weather_algo_evaluation_log_recording_enabled BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE weather_config ADD COLUMN weather_algo_forecast_history_retention_days INTEGER NOT NULL DEFAULT 90`);
    await queryRunner.query(`ALTER TABLE weather_config ADD COLUMN weather_algo_market_snapshot_retention_days INTEGER NOT NULL DEFAULT 30`);
    await queryRunner.query(`ALTER TABLE weather_config ADD COLUMN weather_algo_evaluation_log_retention_days INTEGER NOT NULL DEFAULT 90`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Ordre inverse, IF EXISTS + CASCADE pour sécurité
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_evaluation_log_retention_days`);
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_market_snapshot_retention_days`);
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_forecast_history_retention_days`);
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_evaluation_log_recording_enabled`);
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_market_snapshot_recording_enabled`);
    await queryRunner.query(`ALTER TABLE weather_config DROP COLUMN IF EXISTS weather_algo_forecast_history_recording_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_evaluation_log CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_bucket_ticks CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_market_snapshots CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_forecast_history CASCADE`);
  }
}
```

---

## 12. API de lecture (backend)

### 12.1 Routes


| Méthode  | Path                                                                           | Réponse                                                                            | Usage                          |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------ |
| `GET`    | `/api/weather-algo-data/forecast-history?city=&from=&to=&limit=`               | `{ items, total }`                                                                 | Backtest / audit forecasts     |
| `GET`    | `/api/weather-algo-data/market-snapshots?city=&from=&to=&limit=&includeTicks=` | `{ items, total }` ; `includeTicks` défaut `**false**` (ticks via `/bucket-ticks`) | Backtest / audit marchés       |
| `GET`    | `/api/weather-algo-data/bucket-ticks?...`                                      | `{ items, total }` (+ `cityNormalized`)                                            | Audit ticks                    |
| `GET`    | `/api/weather-algo-data/evaluation-log?from=&to=&strategyId=&decision=&limit=` | `{ items, total }`                                                                 | Audit décisions algo           |
| `GET`    | `/api/weather-algo-data/forecast-cache?...`                                    | `{ items, total }`                                                                 | Cache opérationnel             |
| `GET`    | `/api/weather-algo-data/position-forecasts?...`                                | `{ items, total }` (+ `openedAt`)                                                  | Snapshots d’entrée             |
| `GET`    | `/api/weather-algo-data/tables`                                                | `{ tables[] }` rowCount / oldest / newest                                          | UI onglet Données              |
| `DELETE` | `/api/weather-algo-data/tables`                                                | `{ deleted, totalDeleted }`                                                        | Purge UI (6 tables)            |
| `GET`    | `/api/weather-algo-data/coverage`                                              | `{ from, to, cities[], totals… }`                                                  | Legacy (UI Paramètres retirée) |


**Fichier** : `packages/backend/src/routes/weather-algo-data.ts` — détail : `[applied/2026-08-08_IMPL-weather-market-data-persistence.md](./applied/2026-08-08_IMPL-weather-market-data-persistence.md)`

### 12.2 Warnings de fidélité backtest

> **Non livré (2026-08-09)** : les warnings quantitatifs ci-dessous
> (`inactiveBucketsExcluded`, `arbitrage_unreliable`, `missingSnapshots`, …)
> ne sont **pas** implémentés dans `packages/backtest`. Voir les codes réellement
> émis dans `[../backtest.md](../backtest.md)` §1 et le patch
> `[applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md](./applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)`.

Le `WeatherDataLoader` devait émettre ces warnings (fix #11 — buckets inactifs non enregistrés) :

```typescript
{
  inactiveBucketsExcluded: number,        // total_bucket_count - bucket_count (somme)
  yesPriceNulls: number,                  // buckets avec yesPrice null
  noPriceNulls: number,                   // buckets avec noPrice null
  forecastRevisionsPerDay: number,
  snapshotsPerDay: number,
  missingSnapshots: number,               // gaps temporels
}
```

**Caveat arbitrage** : si `inactiveBucketsExcluded > 0` pour une ville/date, le `Σ yesPrice` calculé en backtest sera **incomplet** → les résultats de `weather-arbitrage` sont non fiables pour ces snapshots. Le backtest doit marquer ces runs avec un warning `arbitrage_unreliable`.

---

## 13. Impact performance

### Overhead par cycle (batch + await — choix utilisateur)


| Opération                               | Coût                                         | Fréquence                                                    |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| INSERT forecast_history                 | 1 insert                                     | par (city, date) si fetch réel (cache miss, TTL typique 1 h) |
| INSERT snapshot + buckets (transaction) | 2 inserts (1 snapshot + 1 bulk bucket_ticks) | par ville/date évaluée                                       |
| INSERT evaluation_log (batch)           | 1 bulk insert                                | par ville/date évaluée                                       |


**Défaut réel** : `weatherAlgoPollMs = 1_800_000` (30 min), pas 15 s.

**Estimation au défaut** (~10 villes × 3 dates look-ahead, toggles ON) :

- ~30 groupes ville/date / cycle → ~30 snapshots + ~30 batch eval_log + quelques forecast_history (cache hits dominants)
- Latence I/O ajoutée : ordre de grandeur **dizaines de ms** → négligeable vs poll 30 min
- Volume snapshots : ~30 × 48 cycles/jour ≈ **~1 440/jour** (pas ~2 880) ; bucket_ticks / eval_log proportionnels au nb de buckets actifs

Si l’utilisateur baisse `pollMs` (min Zod = 10 s), le volume monte linéairement — surveiller la DB.

**Guard anti-overlap** : le runner a déjà `cycleRunning`/`pendingRerun` (strategy-runner.ts L145-165). Si l'I/O ralentit le cycle, les cycles se chevauchent mais ne se perdent pas (pendingRerun).

**Toggle** : 3 toggles indépendants, **activés par défaut** (migration `DEFAULT true`) pour accumulation immédiate en SIM prod. Désactiver manuellement en REAL si besoin.

---

## 14. Plan d'implémentation

### Phase 0 — Foundation (~4h30)


| Tâche                                                                             | Fichier                                                                                          | Effort |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Migration `AddWeatherMarketDataPersistence` (timestamp **après** `1700000000095`) | `packages/core/src/migrations/`                                                                  | 45 min |
| Enregistrer migration + 4 entités dans `data-source.ts` (V4-4)                    | `packages/core/src/database/data-source.ts`                                                      | 15 min |
| 4 entités TypeORM                                                                 | `packages/core/src/entities/Weather{ForecastHistory,MarketSnapshot,BucketTick,EvaluationLog}.ts` | 1h     |
| Export des entités dans `packages/core/src/entities/index.ts`                     | existant                                                                                         | 5 min  |
| 6 colonnes `WeatherConfig` (3 toggles + 3 rétentions)                             | `packages/core/src/entities/WeatherConfig.ts`                                                    | 20 min |
| Zod : 6 champs dans `weatherConfigUpdateSchema` (`.strict()`) (V4-4)              | `packages/backend/src/routes/config-per-kind.ts`                                                 | 15 min |
| `resolveBucketPrices` helper (`binaryPricesFromParsed`)                           | `packages/weather-algo/src/strategy/runner-bucket-helpers.ts`                                    | 30 min |
| `WeatherForecastHistoryRecorder` + export `services/index`                        | `packages/core/src/services/`                                                                    | 45 min |
| `WeatherMarketSnapshotRecorder` (transaction) + export                            | `packages/core/src/services/`                                                                    | 1h     |
| `WeatherEvaluationRecorder` (batch) + export                                      | `packages/core/src/services/`                                                                    | 30 min |


**Critère** : migration passe, entités compilent, recorders unit-testés (insert + purge + cascade), PATCH `/config/weather` accepte les 6 champs.

### Phase 1 — Extension interfaces + intégration runner (~4h)


| Tâche                                                                                                                | Fichier                                                           | Effort |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Étendre `WeatherEvaluationResult` (forecastProb, edge, dynamicMinEdge sur abstain)                                   | `packages/weather-algo/src/strategy/strategy.ts`                  | 15 min |
| Étendre `WeatherSignal` avec `dynamicMinEdge`                                                                        | `packages/weather-algo/src/strategy/strategy.ts`                  | 10 min |
| Mettre à jour `WeatherForecastStrategy.evaluate` (exposer champs sur abstain)                                        | `packages/weather-algo/src/strategy/weather-forecast.strategy.ts` | 45 min |
| Étendre `WeatherForecastService.getOrFetch` (retourner `isFresh` + modelValues + `isStaleFallback`)                  | `packages/core/src/services/weather-forecast.service.ts`          | 30 min |
| Restructurer `evaluateCityFollowDateGroup` (ordre V4-3 : collecte → snapshot → guards → evaluate ; ajouter `ruleId`) | `packages/weather-algo/src/strategy/strategy-runner.ts`           | 1h     |
| Injection recorders + 3 points d'injection                                                                           | idem                                                              | 1h     |
| Guard de cohérence (eval sans snapshot → warning)                                                                    | idem                                                              | 15 min |
| try/catch best-effort sur tous les `await recorder.*`                                                                | idem                                                              | 15 min |
| MAJ appels tests `evaluateCityFollowDateGroup` (R4)                                                                  | `strategy-runner.test.ts`                                         | 20 min |


**Critère** : avec toggles ON, chaque cycle écrit forecast_history (si fetch) + snapshot + bucket_ticks + batch eval_log. Avec toggles OFF, aucun I/O. Guard de cohérence logge warning si eval sans snapshot. Snapshot écrit même si forecast null / 0 buckets.

### Phase 2 — Purge + bootstrap (~1h30)


| Tâche                                                              | Fichier                              | Effort |
| ------------------------------------------------------------------ | ------------------------------------ | ------ |
| Instancier recorders dans `main()`                                 | `packages/weather-algo/src/index.ts` | 15 min |
| Purge horaire `safeInterval` (**indépendante des toggles** — V4-2) | `packages/weather-algo/src/index.ts` | 30 min |
| `clearInterval` dans `shutdown`                                    | idem                                 | 5 min  |
| Passer recorders au `StrategyRunner`                               | idem                                 | 10 min |


**Critère** : purge horaire supprime les lignes > rétention même si recording OFF ; cascade bucket_ticks ; ne bloque pas le shutdown.

### Phase 3 — UI (~1h45) — **FAIT** (évolué)


| Tâche                                                                                    | Fichier                                          | Effort    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| 3 toggles UI "Enregistrement données backtest" (onglet **Paramètres**)                   | `WeatherAlgoSettingsTab.tsx`                     | 30 min    |
| 3 champs rétention UI                                                                    | idem                                             | 15 min    |
| ~~Mini panneau couverture~~ → **remplacé** par onglet **Données** (`WeatherAlgoDataTab`) | `WeatherAlgoPage.tsx` + `WeatherAlgoDataTab.tsx` | post-plan |
| Type `WeatherConfig` + payload (6 champs) (V4-4)                                         | `api.ts` + SettingsTab                           | 20 min    |


**Critère** : 3 toggles persistés indépendamment, rétention configurable, round-trip GET/PATCH OK. Exploration / purge via onglet Données.

### Phase 4 — API lecture (~2h) — **FAIT** (+ extensions UI)


| Tâche                                                                                                                         | Fichier                               | Effort    |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------- |
| Routes list + `/coverage` + mount                                                                                             | `weather-algo-data.ts` / `index.ts`   | plan      |
| Extensions post-plan : `/tables`, `DELETE /tables`, `/bucket-ticks`, `/forecast-cache`, `/position-forecasts`, `includeTicks` | idem + `weather-algo-data.service.ts` | post-plan |


Voir doc d’implémentation pour l’état réel des routes.

### Phase 5 — Intégration backtest — **HORS SCOPE** (V4-6)

`packages/backtest` n’existe pas encore. Différer au plan `[2026-08-05_PLAN-backtest-engine-universel.md](./2026-08-05_PLAN-backtest-engine-universel.md)` (Phase weather + `WeatherDataLoader` consommant `weather_market_snapshots` / `weather_bucket_ticks` / `weather_forecast_history` / `weather_evaluation_log`).

Ne pas bloquer le merge prod des Phases 0–4 sur cette phase.

### Total Phases 0–4 : ~13h30

---

## 15. Tests

### 15.1 Tests unitaires


| Composant                           | Test                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `resolveBucketPrices`               | Résolution YES/NO via `outcomes[]`, null si absent, ordre non garanti  |
| `WeatherForecastHistoryRecorder`    | Insert append-only, pas d'écrasement, purge batch                      |
| `WeatherMarketSnapshotRecorder`     | Insert snapshot + buckets en transaction, cascade delete via FK        |
| `WeatherEvaluationRecorder`         | Batch insert (1 INSERT pour N inputs), purge                           |
| `WeatherForecastStrategy` (étendu)  | abstain expose `forecastProb`/`edge`/`dynamicMinEdge` quand calculés   |
| Runner avec tous toggles OFF        | Aucun I/O, comportement inchangé                                       |
| Runner avec forecastHistory ON seul | 1 forecast_history si fetch, 0 snapshot, 0 eval_log                    |
| Runner avec snapshot ON seul        | N snapshots + bucket_ticks, 0 eval_log                                 |
| Runner avec eval ON sans snapshot   | Warning loggé, eval_logs avec snapshotId null                          |
| Runner avec tous ON                 | 1 forecast + N snapshots + N bucket_ticks + 1 batch eval_log par cycle |
| Erreur BDD pendant recording        | Cycle continue, warning loggé, trading non interrompu                  |


### 15.2 Test d'intégration

```typescript
// e2e/weather-algo/weather-data-persistence.e2e.test.ts
// 1. Activer les 3 toggles
// 2. Lancer 2 cycles (mock discovery + forecast fetch)
// 3. Vérifier : 2 snapshots, ~16 bucket_ticks, ~16 eval_logs, 1+ forecast_history
// 4. Vérifier : eval_log.decision = 'signal' pour le bucket sélectionné
// 5. Vérifier : eval_log.dynamic_min_edge non null pour abstain 'insufficient_edge'
// 6. Désactiver toggles → 1 cycle → aucune nouvelle ligne
// 7. Purge rétention 0 → snapshots supprimés, bucket_ticks en cascade, eval_logs avec snapshot_id null
// 8. Vérifier cascade : 0 bucket_ticks orphelins
```

### 15.3 Test fidélité backtest (différé — Phase 5 / plan universel)

```typescript
// packages/backtest/... — hors scope de ce plan (V4-6)
// Quand packages/backtest existera :
// 1. Fixtures : snapshots × buckets
// 2. WeatherDataLoader stream + warnings inactiveBuckets / arbitrage_unreliable
// 3. Comparer signaux backtest vs weather_evaluation_log
```

---

## 16. Risques résiduels


| Risque                                                                 | Mitigation                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `getOrFetch` étendu casse d'autres appelants                           | `getCached` inchangé ; `getOrFetch` retourne un sur-type (ajoute champs, ne supprime pas)                 |
| Restructuration `evaluateCityFollowDateGroup` introduit une régression | MAJ tests R4 ; assertions métier inchangées (best-edge, abstain → null)                                   |
| Batch eval_log échoue partiellement                                    | TypeORM `insert` est atomique (tout ou rien) — pas de partial insert                                      |
| Performance batch + await si BDD lente                                 | Guard `cycleRunning`/`pendingRerun` ; volume réel au défaut 30 min reste faible                           |
| Buckets inactifs exclus → arbitrage unreliable                         | Warning `arbitrage_unreliable` dans le backtest ; spec arbitrage documente la limitation                  |
| `resolveBucketPrices` retourne null si outcomes vides                  | Snapshot enregistre null, backtest ignore le bucket, warning `yesPriceNulls`                              |
| FK CASCADE supprime des bucket_ticks en cascade                        | Comportement voulu (snapshot = parent)                                                                    |
| `forecast_mean = 0` confondu avec « indisponible »                     | Colonnes nullable ; `null` = indisponible, `0` = vraie température ; backtest teste `IS NULL` (pas falsy) |
| Purge oubliée si toggles OFF                                           | V4-2 : purge toujours selon rétention                                                                     |
| Phase 5 / `packages/backtest` absent                                   | V4-6 : hors scope ; collecte seule livrable en prod                                                       |


---

## 17. Ordre de priorité

1. **Phase 0 + 1** (foundation + interfaces + runner) — démarrer la collecte
2. **Phase 2** (purge + bootstrap) — nécessaire pour la prod (sinon stockage infini)
3. **Phase 3** (UI Paramètres) — activation depuis l'interface
4. **Phase 4** (API lecture) — audit et debug
5. **Phase 5** — différée (plan backtest universel)

**Recommandation prod SIM** : implémenter Phases 0–4 ; **à la première mise en prod SIM, les 3 toggles d’enregistrement sont activés par défaut** (migration `DEFAULT true`) pour démarrer l’accumulation immédiatement. En prod REAL, désactiver manuellement ou prévoir un override si besoin.

**Décisions utilisateur (2026-08-08)** :

- Phase 5 (backtest) : **différée**
- Phase 4 + UI : **onglet Données** (cards / drill-down / purge) — remplace le mini panneau couverture Paramètres (voir doc IMPL)
- Activation SIM : **3 toggles ON par défaut** à la migration (`weather_algo_*_recording_enabled DEFAULT true`)

---

## 18. Diagramme de flux complet (v4)

```
                    ┌─────────────────────────────────────┐
                    │    weather-algo (process)            │
                    │    WeatherStrategyRunner              │
                    │    (runEvaluationCycle)               │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   getOrFetch()            evaluateCityFollowDateGroup    strategy.evaluate
   (cache miss →           (collecte → snapshot →         (exposé :
    forecast_history)       guards → evaluate)             forecastProb/edge/
          │                        │                      dynamicMinEdge)
          ▼                        ▼                        ▼
   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
   │ ForecastHistory│         │ MarketSnapshot│         │ EvaluationLog │
   │ Recorder      │         │ Recorder      │         │ Recorder      │
   │ (try/catch)   │         │ (transaction) │         │ (batch)       │
   └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
          │                        │                        │
          ▼                        ▼                        ▼
   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
   │ weather_     │         │ weather_      │         │ weather_     │
   │ forecast_    │  (pas   │ market_       │←─FK────│ evaluation_  │
   │ history      │   de FK)│ snapshots     │ SET NULL│ log          │
   │ (append-only)│         │      │        │         │              │
   └──────────────┘         │      │ CASCADE│         └──────────────┘
                            │      ▼        │
                            │ weather_      │
                            │ bucket_ticks  │
                            └───────────────┘
          │                        │
          │           ┌────────────┘
          │           │ (purge horaire — indépendante des toggles)
          ▼           ▼
   ┌─────────────────────────────────────┐
   │    Purge Timer (weather-algo)        │
   │    safeInterval 1h                   │
   │    • forecast_history (> rétention)  │
   │    • snapshots + bucket_ticks        │
   │    • evaluation_log                  │
   └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │    backend (process)                 │
                    │    API REST /api/weather-algo-data/* │
                    │    (lecture seule — Phase 4)         │
                    └─────────────────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────┐
                    │    Backtest Engine (plus tard)       │
                    │    WeatherDataLoader — hors scope    │
                    └─────────────────────────────────────┘
```

