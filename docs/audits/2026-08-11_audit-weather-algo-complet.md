# Audit — Weather Algo (complet)

- **Date** : 2026-08-11
- **Type** : audit read-only de la partie weather algo (aucun fichier corrigé)
- **Périmètre** : package `backtest`, package `core` (services + `weather/` + migrations), routes backend `weather-algo-*.ts` + `backtest.ts`, frontend (components / hooks / lib / api), documentation (`weather-algo.md`, `api.md`, `backtest.md`, `modele-donnees.md`)
- **Méthode** : chaque constat préliminaire du plan a été **confirmé ou réfuté par lecture directe du code** (extraits et lignes cités pour traçabilité)

> Les corrections feront l'objet d'un plan distinct après validation de ce rapport.

---



## 1. Conflits de logique / cohérence


| #                   | Constat                                                                                                                                                                                                                                                                                                                                                                                                                             | Localisation                                                           | Sévérité    | Implémenté |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- | ---------- |
| **C1**              | `getOrFetch` retourne `isFresh: false` (ligne 101) alors que la route `weather-algo-forecasts.ts` met `true` (ligne 68). Le service persisté avec `isFresh:true` (ligne 92) est renvoyé `isFresh:false` → flag sémantiquement incohérent pour tout appel via `getOrFetch`.                                                                                                                                                          | `weather-forecast.service.ts:95-103` vs `weather-algo-forecasts.ts:68` | 🔴 Critique | ✅          |
| **C2**              | `bucketLabel` tripliqué avec unités divergentes : `°C` dans `lib/weather-position.ts` (lignes 34-42) vs `°` dans `WeatherBucketTimelineView.tsx:32` et `WeatherClobTimelineView.tsx:41`. Le suffixe est codé en dur et ne reflète pas l'unité réelle du marché.                                                                                                                                                                     | 3 fichiers frontend                                                    | 🔴 Critique | ✅          |
| **C3**              | `VALID_TABLE_IDS` (route `weather-algo-data.ts:6-14`) duplique `WeatherAlgoDataTableId` (service `weather-algo-data.service.ts:14-21`). Toute nouvelle table impose 2 edits manuels.                                                                                                                                                                                                                                                | route vs service                                                       | 🟠 Haute    | ✅          |
| **C4**              | Restrictions `metric` inconsistantes (voir matrice §1.1) : `question-builder` ne supporte que `highest_temp`/`lowest_temp` ; `weather-forecast.service` accepte `string` libre ; les routes valident un enum strict ; les tests seedent `metric: 'temp'`.                                                                                                                                                                           | multiple                                                               | 🟠 Haute    | ✅          |
| **C5**              | `parseExitReason` (route `backtest.ts`) hardcode une liste qui duplique l'union `BacktestExitReason` core → drift si une nouvelle raison est ajoutée.                                                                                                                                                                                                                                                                               | route `backtest.ts`                                                    | 🟠 Haute    | ✅          |
| **C6**              | `weather-algo-forecasts.ts` re-implémente cache-then-fetch (lignes 36-74) au lieu d'appeler `getOrFetch` → **divergence** avec le service : la route met `isFresh: true` (correct) tandis que `getOrFetch` (C1) retourne `isFresh: false` pour le même forecast frais. La duplication ne reproduit pas le bug de C1, elle crée deux chemins incohérents.                                                                            | route                                                                  | 🟠 Haute    | ✅          |
| **C7**              | `proxyFallback` toujours `true` dans `resolution.ts` (lignes 25, 34) — champ retourné mais jamais consommé.                                                                                                                                                                                                                                                                                                                         | `resolution.ts`                                                        | 🟡 Moyenne  | ✅          |
| **C8**              | ⚠️ **Réfuté** : la migration `SplitRiskConfigPerAlgoKind1700000000087` (lignes 240-293) crée bien `weather_config`. Le « renommage » `risk_config→weather_config` est en réalité une **copie** `INSERT INTO ... SELECT FROM risk_config` (lignes 682-768) puis `DropLegacyRiskConfig1700000000088` supprime l'ancienne table. Pas de bug réel.                                                                                      | migrations `0087` / `0088`                                             | ⚪ Résolu    | N/A        |
| **C9** *(nouveau)*  | ⚠️ **Réfuté** : la branche `?? {}` ligne 291 de `getStrategyParams` **est atteignable**. `parseWeatherAlgoStrategyParams(...)` retourne bien toujours un objet, mais l'indexation `[strategyId]` sur la map renvoie `undefined` quand la clé est absente — c'est précisément le cas que `?? {}` couvre. Le constat confondait le retour de la fonction (toujours un objet) avec l'accès indexé (peut être `undefined`). Pas de bug. | `strategy-catalog.ts:291`                                              | ⚪ Résolu    | N/A        |
| **C10** *(nouveau)* | Asymétrie de bin CDF : `computeCdfBelow(target)` = `normalCDF(target)` (aucun décalage de bin) alors que `computeCdfAbove(target)` = `1 - normalCDF(target - 0.5)`. Pour un marché « or_below » (`P(temp <= X)`) vs « or_above » (`P(temp >= X)`), les deux probabilités YES n'utilisent pas la même convention → trou de 0.5 °C.                                                                                                   | `forecast-distribution.ts:49-71`                                       | 🔴 Critique | ✅          |
| **C11** *(nouveau)* | Asymétrie de tolérance `isForecastInBucket` : `between`/`exact` utilisent `±0.5` (lignes 42, 46) mais `or_below`/`or_above` n'ont aucune tolérance (lignes 50, 54) → un forecast mean à la limite est classé différemment selon le type de bucket.                                                                                                                                                                                  | `weather-exit-helpers.ts:38-58`                                        | 🟡 Moyenne  | ✅          |
| **C12** *(nouveau)* | L'index unique d'`upsertPoints` couvre `condition_id, side, recorded_at, fidelity_minutes` mais **pas** `metric` (lignes 657-664) — deux séries de métriques différentes sur le même `condition_id` s'écraseraient. Commenté « sans risque » car un `condition_id` a une métrique fixe, mais reste fragile.                                                                                                                         | `weather-history-ingest.service.ts:657-664`                            | 🟡 Moyenne  | ✅          |




### 1.1 Matrice de cohérence `metric` (C4)

> **État post-implémentation (2026-08-12)** : toutes les restrictions `metric` sont centralisées sur le type canonique `WeatherMetric` (const array `WEATHER_METRICS = ['highest_temp','lowest_temp']`) et le guard runtime `isWeatherMetric`, exportés depuis `@polywatch/core`. La matrice ci-dessous décrit l'état **avant** la correction (valeur d'audit).

| Couche                                 | Valeurs autorisées                                       | Fichier                                   |
| -------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `question-builder` (synthèse question) | `highest_temp` / `lowest_temp` uniquement                | `question-builder.ts:33`                  |
| `weather-forecast.service.getOrFetch`  | `'highest_temp' | 'lowest_temp' | string` (string libre) | `weather-forecast.service.ts:42`          |
| Route `weather-algo-forecasts`         | enum strict `['highest_temp','lowest_temp']`             | `weather-algo-forecasts.ts:16`            |
| Route `weather-algo-history` (ingest)  | enum strict                                              | `weather-algo-history.ts:15`              |
| `WeatherAutoTrackService.addRule`      | `string = 'highest_temp'` (default, non restreint)       | `weather-auto-track.service.ts:27`        |
| Tests core                             | `metric: 'temp'`                                         | tests `weather-algo-data.service.test.ts` |
| Entité / DB                            | `string` (colonne TEXT)                                  | `WeatherAutoTrackRule`                    |


**Conclusion** : seule la route forecasts valide strictement. Le service accepte `string` libre mais masque le risque via `metric as 'highest_temp'|'lowest_temp'` (ligne 62). Les tests utilisent une valeur (`temp`) absente des enums de routes → incohérence de données possibles.

**Post-fix** : `getOrFetch`/`getCached`/`save`/`addRule` resserrés sur `WeatherMetric` (plus de `string` libre) ; les 2 routes utilisent `isWeatherMetric` ; les 4 casts `as 'highest_temp'|'lowest_temp'` remplacés par guards runtime (`strategy-runner`, `weather-exit-evaluator`, `weather-history-ingest`, route forecasts) ; les tests seedent `metric: 'highest_temp'`. Les colonnes entité restent `string` (compat legacy, pas de migration) ; `getCached` retourne `null` si `row.metric` invalide.

---



## 2. Inventaire dead code


| #   | Élément                                                                                                                                                                                                                                                                           | Localisation                                                            | Vérifié                                                             | Recommandation                                                                                                                              | Implémenté |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | `WeatherCityGroup.tsx` (composant générique)                                                                                                                                                                                                                                      | frontend                                                                | ✅ aucun importeur                                                   | Supprimer                                                                                                                                   | ✅          |
| D2  | `lib/weather-grouping.ts` + `groupByCity`                                                                                                                                                                                                                                         | frontend                                                                | ✅ aucun importeur                                                   | Supprimer (récupérer si besoin pour tests)                                                                                                  | ✅          |
| D3  | `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage`                                                                                                                                                                                                                        | `api.ts:644,810`                                                        | ✅ aucun appelant                                                    | Supprimer (frontend uniquement ; route backend `/coverage` + type core conservés)                                                          | ✅          |
| D4  | `ClockedWeatherForecastStrategy` (deprecated)                                                                                                                                                                                                                                     | `clocked-weather-strategy.ts:70-74`                                     | ✅ aucun appelant                                                    | Supprimer                                                                                                                                   | ✅          |
| D5  | `createWeatherAdapter` export                                                                                                                                                                                                                                                     | `backtest/src/index.ts:75-77`                                           | ✅ aucun consommateur                                                | Supprimer (+ import `RunContext` inutilisé retiré)                                                                                          | ✅          |
| D6  | `WeatherReconstructedMarket` interface                                                                                                                                                                                                                                            | `context-builder.ts:6-13`                                               | ✅ inutilisée                                                        | Supprimer                                                                                                                                   | ✅          |
| D7  | ⚠️ **Réfuté** : `WeatherRuntimeStatus` est une **interface interne utilisée** (lecture lignes 57, 60), pas un export mort                                                                                                                                                         | `weather-algo-markets.ts:11`                                            | ❌ PAS dead code                                                     | Conserver                                                                                                                                   | N/A        |
| D8  | Variant `timer` dans `BacktestEvent`                                                                                                                                                                                                                                              | `events.ts:62`                                                          | ✅ jamais produit/consommé                                           | Supprimer (union)                                                                                                                           | ✅          |
| D9  | `formatDate` no-op dans question-builder                                                                                                                                                                                                                                          | `question-builder.ts:10-14`                                             | ✅ retourne l'input tel quel                                         | Inliner / supprimer                                                                                                                         | ✅          |
| D10 | `DEFAULT_STRATEGIES_JSON` / `DEFAULT_PARAMS_JSON`                                                                                                                                                                                                                                 | `strategy-catalog.ts:227-228,366`                                       | ✅ exports, aucun import                                             | Supprimer                                                                                                                                   | ✅          |
| D11 | Routes legacy : `POST /` (no-op 410), `syncMarketSelectionsForAutoTrack` (no-op) — mais `DELETE /:conditionId` et `PATCH /:conditionId` (204/200) **ne sont pas de pures no-op** : elles émettent des side-effects event-bus (`publishConfigChanged` / `emitAlgoMarketsChanged`). | `weather-algo-markets.ts:88-108`, `weather-auto-track.service.ts:85-87` | ✅                                                                   | Supprimer `POST /`, `DELETE`, `PATCH`, `POST /notify-changed` (aussi mort) et `syncMarketSelectionsForAutoTrack` + type `WeatherAutoTrackSyncResult` + cycle janitor weather complet | ✅          |
| D12 | Champs `WeatherConfig` non lus par le frontend (~30 legacy)                                                                                                                                                                                                                       | `api.ts`                                                                | ⚠️ non vérifié en profondeur (cross-check champ par champ non fait) | Documenter / nettoyer                                                                                                                       | ⏸️ (hors scope — audit futur) |
| D13 | ⚠️ **Réfuté** : `git ls-files "node_modules/@polywatch/*/node_modules/.vite/vitest/*"` ne retourne **aucun fichier**. Les fichiers `node_modules` ne sont pas trackés par git. Constat initial faux (probable confusion avec le `git status` non-tracké du working dir).          | `node_modules/...`                                                      | ⚪ Résolu                                                            | N/A                                                                                                                                         | N/A        |


---



## 3. Risques techniques


| #              | Constat                                                                                                                                           | Localisation                                  | Sévérité    | Implémenté |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------- | ---------- |
| T1             | `pollJob` `while(true)` sans `onCleanup` → `patchRow` (setState) sur composant unmounté + fuite                                                   | `WeatherAlgoHistoryIngestSection.tsx:180-203` | 🔴 Critique | ✅          |
| T2             | `setInterval` stale-sweep jamais nettoyé (leak sur hot-reload) ; seul `unref()` est appliqué                                                      | `weather-algo-history.ts:29-34`               | 🟠 Haute    | ✅          |
| T3             | `JSON.parse(row.modelValues)` sans try/catch → crash de `getCached` si JSON corrompu                                                              | `weather-forecast.service.ts:124`             | 🟠 Haute    | ✅          |
| T4             | Assertions `!` sur `target` nullable (`target!`) → si `target` est `null`, `normalCDF(NaN)` → NaN silencieux                                      | `forecast-distribution.ts:105,109,115-116`    | 🟠 Haute    | ✅          |
| T5             | Side-effects en render (`if (!loaded()) void load()`)                                                                                             | StrategiesTab / SettingsTab                   | 🟡 Moyenne  | ✅          |
| T6 *(nouveau)* | `WeatherPositionForecastService.saveIfAbsent` fait un `findOne` puis un `save` non atomique ; le catch gère la concurrence mais pas l'upsert race | `weather-position-forecast.service.ts:37-64`  | 🟡 Moyenne  | ✅          |
| T7 *(nouveau)* | `markClosed(pos.city ?? '')` — le throttle de ré-entrée est keyé sur `''` pour les positions sans ville                                           | `exit-manager.ts:151`                         | 🟡 Moyenne  | ✅          |


---



## 4. Besoins de refactor / simplification


| #   | Refactor                                                                                                                                            | Fichier                                | Effort | Implémenté |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------ | ---------- |
| R1  | Extraire l'agrégateur timeline commun (dup ~100 lignes entre `getBucketTicksTimeline` et `getClobPriceHistoryTimeline`)                             | `weather-algo-data.service.ts:391-664` | 2h     | ✅          |
| R2  | Split `WeatherAlgoDataTab.tsx` 906 lignes (rows non typées, 2 sources de table IDs)                                                                 | frontend                               | 3h     | ✅          |
| R3  | Consolider `WeatherAlgoBacktestTab.tsx` 729 lignes (fallback strategy hardcoded, formatters dupliqués, `EXIT_REASON_LABEL` inline, 1 cadence poll) | frontend                               | 3h     | ✅          |
| R4  | Extraire `formatBucketLabel` unifié (résout C2)                                                                                                     | 3 fichiers                             | 1h     | ✅          |
| R5  | Nettoyer `weather-market-discovery.ts` (debug Paris lignes 99-119, magic numbers `MAX_PAGES`/`MAX_RANGE_PAGES`, tri Paris-first)                    | core                                   | 1h     | ✅          |
| R6  | Consolider helpers routes (`parseLimit` / `parseOffset` / `parseOptionalDate`)                                                                      | routes                                 | 1h     | ✅          |
| R7  | Factoriser le tableau watched-cities (ActiveMarketsPanel + AutoTrackTab)                                                                            | frontend                               | 1h     | ✅          |
| R8  | Consolider formatters (`formatTs`/`formatNum`/`formatCents`/`formatPollInterval`) dans `lib/format.ts`                                              | frontend                               | 1h     | ✅          |
| R9  | Unifier `FIDELITY_OPTIONS` (3 copies, shapes `string` vs `number`)                                                                                  | 3 fichiers                             | 30 min | ✅          |
| R10 | Split `evaluateExits()` ~120 lignes dans l'adapter (résout la duplication `getCurrentForecast` ×2)                                                  | `weather-adapter.ts:553-671`           | 1h     | ✅          |


---



## 5. Doc vs code


| #   | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Doc                                                         | Sévérité   | Implémenté |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- | ---------- |
| F1  | 2 routes data manquantes : `DELETE /tables/:id` (route `weather-algo-data.ts:189`) et `GET /weather-algo-history/jobs` (route `weather-algo-history.ts:64`). ⚠️ **Corrigé** : la version initiale listait 6 routes manquantes, mais `/bucket-ticks/timeline`, `/clob-price-history/timeline` et `DELETE /bucket-ticks/interval` sont **déjà documentées** (`api.md:400-402`).                                                                                                                                                                                                                                                                                                                                                                      | `api.md:390-416`                                            | 🟡 Moyenne | —          |
| F2  | Param `fidelityMinutes` backtest omis dans la liste des paramètres de run (`api.md:440`) — pourtant documenté dans `backtest.md:110`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `api.md`                                                    | 🟡 Moyenne | —          |
| F3  | Wording « 6 tables » stale (le code renvoie 7 avec `clob_price_history`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `api.md:392-393`, `plans/applied/2026-08-08_IMPL-...:57-58` | 🟢 Faible  | —          |
| F4  | Code warning `kill_switch_partial_close` manquant dans le tableau des warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `backtest.md:85-93`                                         | 🟢 Faible  | —          |
| F5  | ⚠️ **Réfuté** : les cross-refs `docs/code/08-weather-algo.md`, `configuration.md`, `plans/applied` existent toutes ; `weather-config-api.ts` et `policy.ts` référencés par `weather-algo.md` existent aussi. Le package `packages/weather-algo/` **existe et est tracké par git** (27 fichiers, dont `package.json`, `src/index.ts`, `src/strategy/weather-forecast.strategy.ts`) ; il est importé par `@polywatch/weather-algo` (ex. `clocked-weather-strategy.ts:6`). Le constat initial (cross-refs manquantes) est donc réfuté. *(Correction 2026-08-12 : la version précédente indiquait à tort que le dossier n'apparaissait pas dans git status — confusion entre fichiers non-trackés du working dir et fichiers déjà trackés/committés.)* | multiple                                                    | ⚪ Résolu   | N/A        |


---



## 6. Synthèse par sévérité

**🔴 Critique (4)** : C1 (✅ implémenté), C2 (✅ implémenté), C10 (✅ implémenté — asymétrie CDF), T1 (✅ implémenté — `pollJob` annulable via `onCleanup`). → **0 actif**.

**🟠 Haute (8)** : C3 (✅ implémenté), C4 (✅ implémenté), C5 (✅ implémenté), C6 (✅ implémenté), T2 (✅ implémenté — cleanup `clearInterval` au shutdown), T3 (✅ implémenté — `JSON.parse` protégé), T4 (✅ implémenté — guard `target` null), C12 (✅ implémenté — race upsert). → **0 actif**.

**🟡 Moyenne (7)** : C7 (✅ implémenté), C11 (✅ implémenté), T5 (✅ implémenté — `onMount`), T6 (✅ implémenté — upsert atomique `ON CONFLICT`), T7 (✅ implémenté — skip `markClosed` si ville null), F1, F2 (refactors R1-R10 ✅ implémentés le 2026-08-13). → **reste 2 actifs** (F1, F2).

**🟢 Faible (13)** : F3, F4, D1 (✅ implémenté), D2 (✅ implémenté), D3 (✅ implémenté), D4 (✅ implémenté), D5 (✅ implémenté), D6 (✅ implémenté), D8 (✅ implémenté), D9 (✅ implémenté), D10 (✅ implémenté), D11 (✅ implémenté), D12 (⏸️ hors scope — audit futur). → **reste 3 actifs** (F3, F4, D12).

**Réfutations (5)** : C8 (migration existe), C9 (`?? {}` atteignable), D7 (`WeatherRuntimeStatus` utilisé), D13 (node_modules non trackés), F5 (cross-refs résolues).

---



## 7. Recommandations prioritaires

1. **C1 + C6** : unifier la logique cache/fetch dans `WeatherForecastService` (appeler `getOrFetch` depuis la route) et corriger le flag `isFresh` du retour après fetch. ✅ **Fait** (2026-08-12).
2. **T1** : rendre `pollJob` annulable via `onCleanup` (flag local + garde sur le composant monté). ✅ **Fait** (2026-08-13).
3. **C10 + C11** : aligner les conventions de bin (`or_below` / `or_above` / `exact` / `between`) et les tolérances `isForecastInBucket`. ✅ **Fait** (2026-08-13).
4. **R4 (C2)** : extraire un `formatBucketLabel(unit)` unique et propager l'unité du marché (C vs F). ✅ **Fait** (2026-08-12).
5. **C3-C5** : centraliser les sources de vérité (`WEATHER_ALGO_DATA_TABLE_IDS`, `WeatherMetric`/`isWeatherMetric`, `BACKTEST_EXIT_REASONS`) dans `@polywatch/core` et resserrer les types. ✅ **Fait** (2026-08-12).
6. **T3** : encadrer `JSON.parse(row.modelValues)` d'un try/catch. ✅ **Fait** (2026-08-13) — avec T2/T4/T5/T6/T7, cf. §13.
7. **F1-F4** : mettre à jour `api.md` / `modele-donnees.md` / `backtest.md`.
8. **D1-D12** : purger le dead code selon l'inventaire §2 (D13 réfuté — les fichiers `node_modules` ne sont pas trackés par git, aucune action gitignore nécessaire). ✅ **Fait** (2026-08-13) — D1-D11 supprimés, D12 hors scope (audit futur), D13 réfuté.

Aucun fichier n'a été modifié pendant l'audit initial ; les implémentations sont suivies en §9 (C1/C2/C6), §10 (C3/C4/C5), §11 (C7/C10/C11/C12), §12 (D1-D11 dead code) et §13 (T1-T7 risques techniques).

---



## 8. Vérification post-audit (2026-08-12)

Chaque constat a été re-vérifié par lecture directe du code sur disque. Corrections apportées au rapport :

- **C9** → **Réfuté** (était 🟡 Moyenne). `parseWeatherAlgoStrategyParams` retourne toujours un objet, mais l'indexation `[strategyId]` renvoie `undefined` quand la clé est absente — le `?? {}` est donc atteignable et utile. Le constat confondait le retour de la fonction avec l'accès indexé.
- **D13** → **Réfuté** (était 🟢 Faible). `git ls-files "node_modules/@polywatch/*/node_modules/.vite/vitest/*"` ne retourne aucun fichier. Les fichiers ne sont pas trackés par git ; aucune action gitignore nécessaire.
- **F1** → **Corrigé** (reste 🟡 Moyenne). La version initiale listait 6 routes manquantes ; 3 sont en fait déjà documentées (`/bucket-ticks/timeline`, `/clob-price-history/timeline`, `DELETE /bucket-ticks/interval` à `api.md:400-402`). Seules `DELETE /tables/:id` et `GET /weather-algo-history/jobs` manquent réellement.
- **D12** → **Nuancé** (reste 🟢 Faible). Le cross-check champ par champ n'a pas été fait ; le constat reste plausible mais non vérifié en profondeur. Reclassé en 🟢 Faible (était rangé à tort en 🟡 Moyenne dans la synthèse §6 initiale) pour éliminer la contradiction interne.
- **F5** → **Justification corrigée** (reste ⚪ Résolu). Le constat initial (cross-refs manquantes) reste réfuté, mais l'explication affirmait à tort que `packages/weather-algo` n'apparaissait pas dans git status. En réalité le package existe et est tracké par git (27 fichiers) ; la confusion venait de la différence entre fichiers non-trackés du working dir et fichiers déjà committés.
- **C6** → **Reformulé** (reste 🟠 Haute). La version initiale parlait de « duplication du bug `isFresh` ». C'est inexact : la route met `isFresh: true` (correct), c'est `getOrFetch` (C1) qui est buggé (`isFresh: false`). La re-implémentation crée une *divergence* entre deux chemins incohérents, pas une reproduction du bug.
- **D11** → **Précisé** (reste 🟢 Faible). `POST /` et `syncMarketSelectionsForAutoTrack` sont de pures no-op, mais `DELETE /:conditionId` et `PATCH /:conditionId` émettent des side-effects event-bus (`publishConfigChanged` / `emitAlgoMarketsChanged`) — le qualificatif « no-op » pour ces deux routes était inexact.
- **F3** → **Localisation corrigée** (reste 🟢 Faible). La référence à `modele-donnees.md` est retirée : le wording « 6 tables » n'y figure pas (le fichier documente les tables individuellement sans les compter). Seuls `api.md:392-393` et `plans/applied/2026-08-08_IMPL-...:57-58` contiennent le wording stale.
- **§6 Synthèse** → **Comptages corrigés**. La version initiale annonçait 7 🟡 Moyenne et 4 🟢 Faible, mais listait respectivement 8 et 12 éléments. Correction : 7 🟡 Moyenne (D12 déplacé vers 🟢 Faible) et 13 🟢 Faible (F3, F4, D1-D6, D8-D12).

Synthèse mise à jour : 4 constats critiques, 8 hauts, 7 moyens, 13 faibles, 5 réfutations. Aucune question de comportement n'était nécessaire — toutes les corrections découlent directement de la lecture du code. **Implémentation (2026-08-12)** : C1, C2, C3, C4, C5 et C6 sont implémentés (statut `✅` dans le tableau §1) ; R4 est implémenté (statut `✅` dans le tableau §4). C3/C4/C5 détaillés en §10. **Implémentation (2026-08-13)** : C7, C10, C11 et C12 sont implémentés (statut `✅` dans le tableau §1). Détails en §11. **Implémentation (2026-08-13, risques techniques)** : T1, T2, T3, T4, T5, T6 et T7 sont implémentés (statut `✅` dans le tableau §3). Détails en §13. **Implémentation (2026-08-13, refactors)** : R1, R2, R3, R5, R6, R7, R8, R9 et R10 sont implémentés (statut `✅` dans le tableau §4). Détails en §14.

**Impact sur la synthèse §6** : C1, C2, C3, C4, C5, C6, C7, C10, C11, C12, T1, T2, T3, T4, T5, T6 et T7 sont désormais corrigés. Actifs restants — 2 moyens (F1, F2), 3 faibles (F3, F4, D12).

---

## 9. Suivi d'implémentation (2026-08-12)

Les constats **C1**, **C2** et **C6** ont été implémentés et vérifiés (voir [`plans/2026-08-12_PLAN-fix-c1-c2-weather-algo.md`](../plans/2026-08-12_PLAN-fix-c1-c2-weather-algo.md)).

### C1 — flag `isFresh` / `wasFetched`

- `GetOrFetchResult` étendu avec `fetchedAt`, `expiresAt`, `wasFetched: boolean` (`weather-forecast.service.ts`).
- Les 3 chemins de `getOrFetch` peuplent correctement les flags ; le fresh fetch retourne désormais `isFresh: true` (bug corrigé).
- `strategy-runner.ts:600` utilise `forecast.wasFetched && !forecast.isStaleFallback` pour l'history recording — plus jamais sur cache hit ni stale fallback.
- La route `weather-algo-forecasts.ts` réécrite pour appeler `getOrFetch` directement (résout C6) ; contrat API à 11 champs préservé.

### C2 — propagation de l'unité (C vs F)

- Migration `AddUnitToWeatherPositionForecast1700000000109` : colonne `unit text NULL` sur `weather_position_forecasts` (enregistrée dans `data-source.ts`).
- Entité `WeatherPositionForecast.unit`, DTO serializer `WeatherForecastSnapshotDto.unit`, `WeatherPositionForecastInput.unit`, `WeatherSignal.unit`.
- `evaluate-bucket-gate.ts` peuple `unit: parsed.unit` ; `weather-entry-pipeline.ts` persisté via `signal.unit ?? null`.
- Timelines (`weather-algo-data.service.ts`) : `getBucketTicksTimeline` / `getClobPriceHistoryTimeline` re-parsent `question` via `parseWeatherQuestion` (une fois par `conditionId`) et incluent `unit`.
- Frontend : interfaces `api.ts` / `useWeatherAlgoPositions.ts` étendues ; `lib/weather-position.ts` centralise `formatBucketLabel(unit)` / `formatTimelineBucketLabel` / `formatBucketTargetLabel` (résout R4). Les 2 timeline views et les 2 panels importent le helper shared (plus de définition locale) et passent `unit` (5 call sites).

### Validation

- Builds core / weather-algo / backend / frontend : **OK**.
- Tests : **44/44** passent sur les modules concernés ; 1439/1446 globaux (7 échecs hors périmètre, pré-existants).
- Lints : aucun lint error sur les fichiers modifiés.
- Dead code : vérifié — aucun reste (ancien import `fetchWeatherForecast` de la route et anciennes définitions locales `bucketLabel` retirés).

### Reste à faire en prod

- Exécuter `npm run migrate` (colonne `unit`).
- Smoke test route `GET /weather-algo-forecasts/:city/:date` (`isFresh: true` sur fetch frais).
- Smoke test UI (bucket labels `°C`/`°F`).
- Vérifier le log `forecastHistoryRecorder.record` en conditions réelles.

---

## 10. Implémentation C3/C4/C5 (2026-08-12)

Les constats **C3**, **C4** et **C5** ont été implémentés et vérifiés (voir [`plans/2026-08-12_PLAN-fix-c3-c4-c5-weather-algo.md`](../plans/2026-08-12_PLAN-fix-c3-c4-c5-weather-algo.md)).

### C3 — `WEATHER_ALGO_DATA_TABLE_IDS` source unique

- `weather-algo-data.service.ts` : union `WeatherAlgoDataTableId` convertie en const array `WEATHER_ALGO_DATA_TABLE_IDS` (7 tables) ; type dérivé `(typeof ...)[number]`.
- Export via `services/index.ts` ; la route `weather-algo-data.ts` importe l'array et supprime le `VALID_TABLE_IDS` local dupliqué. `isValidTableId` = `includes` sur la source unique.

### C4 — `WeatherMetric` / `isWeatherMetric` canoniques

- **Nouveau module** `weather/metric.ts` : `WEATHER_METRICS` (const array), `WeatherMetric` (type dérivé), `isWeatherMetric` (guard runtime) — source unique, exporté via `@polywatch/core`.
- **Signatures resserrées** sur `WeatherMetric` : `getOrFetch`/`getCached`/`save`/`ForecastResult.metric` (`weather-forecast.service.ts`), `addRule` (`weather-auto-track.service.ts`), `question-parser`, `weather-api-client`, `weather-market-discovery`, `weather-forecast-enricher`, `WeatherSignal.metric` (`strategy.ts`), `strategy-runner.ts:562`.
- **4 casts `as 'highest_temp'|'lowest_temp'` remplacés par guards runtime** `isWeatherMetric` : `strategy-runner.ts:469` (skip rule), `weather-exit-evaluator.ts:121` (skip exit checks), `weather-history-ingest.service.ts:457` (abort job), route `weather-algo-forecasts.ts:16` (400).
- **Routes** : `weather-algo-forecasts.ts` (guard manuel → `isWeatherMetric`) ; `weather-algo-history.ts` (zod enum → `z.custom<WeatherMetric>(isWeatherMetric)`).
- **`getCached`** : valide `row.metric` via `isWeatherMetric` et retourne `null` si invalide (anomalie legacy).
- **Frontend** `api.ts` : DTOs `metric: string` → `WeatherMetric` (7 sites, dont `WeatherMetric | null` pour `WeatherBucketTickDto`) + `WeatherHistoryIngestParams.metric` → `WeatherMetric`.
- **Tests** : `weather-algo-data.service.test.ts` `metric: 'temp'` → `'highest_temp'` (6x) ; nouveau `weather/metric.test.ts` (WEATHER_METRICS + isWeatherMetric) ; mock `isWeatherMetric` ajouté à `weather-exit-evaluator.test.ts`.
- **Colonnes entité `metric` inchangées** (compat legacy) : `WeatherForecastCache`, `WeatherMarketSnapshot`, `WeatherBucketTick`, `WeatherClobPriceHistory`, `WeatherAutoTrackRule`, `WeatherHistoryIngestJob` restent `string`. Aucune migration.
- **`weather-adapter.test.ts`** (`metric: 'precip'` intentionnel, no-op) passe toujours.

### C5 — `BACKTEST_EXIT_REASONS` source unique

- `BacktestPosition.ts` : union `BacktestExitReason` convertie en const array `BACKTEST_EXIT_REASONS` (10 raisons) ; type dérivé, même nom → aucun importeur de type à changer.
- Export via `entities/index.ts` ; `backtest.ts:parseExitReason` utilise `includes(BACKTEST_EXIT_REASONS)` (suppression de la liste littérale).

### Bug corrigé pendant l'audit

- `weather-history-ingest.service.ts:459` — le guard `isWeatherMetric` ajouté omettait `finishedAt` dans l'update d'erreur (job bloqué sans `finishedAt`, conflict guard) → corrigé.

### Validation

- Builds core / weather-algo / backend / frontend : **OK**.
- Tests : weather-algo 60/60, backtest 28/28, weather-history-ingest 15/15, weather-algo-data 18/18, metric 3/3. 5 échecs core + 1 backend pré-existants (hors périmètre).
- Lints : 0 erreur sur les fichiers modifiés (4 warnings pré-existants).
- Périmètre : 22 fichiers source + plan, alignés sur le plan C3/C4/C5.

---

## 11. Implémentation C7/C10/C11/C12 (2026-08-13)

Les constats **C7**, **C10**, **C11** et **C12** ont été implémentés et vérifiés (voir [`plans/2026-08-13_PLAN-fix-c7-c10-c11-c12-weather-algo.md`](../plans/2026-08-13_PLAN-fix-c7-c10-c11-c12-weather-algo.md)).

### C7 — `proxyFallback` sémantiquement correct

- `packages/backtest/src/adapters/weather/resolution.ts` : `resolveWeatherBucket` retourne désormais `proxyFallback: false` lorsqu'un forecast réel est utilisé (le seul chemin de la fonction). Le champ reflète désormais son intention : `true` signifierait « fallback sur proxy », ce qui n'arrive jamais ici.
- Aucun consommateur ne branchait `proxyFallback` (vérifié : aucun import de `ResolutionResult.proxyFallback` hors le type), le changement est donc sans risque de régression comportementale.

### C10 — Symétrie de bin CDF (`computeCdfBelow`)

- `packages/core/src/weather/forecast-distribution.ts` : `computeCdfBelow(target, μ, σ)` passe de `normalCDF(target, μ, σ)` à `normalCDF(target + 0.5, μ, σ)`, symétrique à `computeCdfAbove` qui soustrait `0.5`.
- Convention de bin discrète (1 °C) : le bin du target couvre `[target - 0.5, target + 0.5)`. « Or below » = `temp <= target` → borne supérieure du bin = `target + 0.5`. Les deux probabilités YES d'un marché « or_below » / « or_above » utilisent désormais la même convention, supprimant le trou de 0.5 °C.
- **Tests** (`forecast-distribution.test.ts`) : nouveaux cas vérifiant l'offset `+0.5` (below) / `−0.5` (above), la cohérence interne `cdfBelow + cdfAbove ≈ 1` (pour un target entier), et la disjoint exhaustiveness sur des bins adjacents. Blocs de test dupliqués consolidés.

### C11 — Tolérance de bin dans `isForecastInBucket`

- `packages/core/src/weather/weather-exit-helpers.ts` : les branches `or_below` et `or_above` appliquent désormais une tolérance de `±0.5` alignée sur la convention de bin :
  - `or_below` : `forecastMean <= target + 0.5`
  - `or_above` : `forecastMean >= target - 0.5`
- Cohérent avec `between`/`exact` qui utilisent déjà `±0.5`. Un forecast mean exactement au target est désormais classé `YES` de façon cohérente quel que soit le type de bucket, supprimant la divergence de classification aux limites.
- **Tests** (`weather-exit-helpers.test.ts`) : nouveaux cas aux frontières (`target + 0.5` inclus pour `or_below`, `target - 0.5` inclus pour `or_above`).

### C12 — Index unique `WeatherClobPriceHistory` étendu à `metric`

- `packages/core/src/entities/WeatherClobPriceHistory.ts` : l'index unique passe de `(conditionId, side, recordedAt, fidelityMinutes)` à `(conditionId, side, recordedAt, fidelityMinutes, metric)`.
- `packages/core/src/services/weather-history-ingest.service.ts` : `upsertPoints` met à jour la cible `orUpdate` pour inclure `metric`, permettant de stocker plusieurs métriques pour un même `condition_id` sans collision.
- **Migration** `AddMetricToClobHistoryUniqueKey1700000000110.ts` : `DROP` l'ancienne contrainte puis `ADD` la nouvelle incluant `metric`. Enregistrée dans `data-source.ts` chronologiquement après `AddUnitToWeatherPositionForecast1700000000109`. `metric` étant déjà une colonne `NOT NULL`, aucun backfill de données n'est nécessaire ; la migration `DROP`+`ADD` est idempotente.
- **Tests** (`weather-history-ingest.service.test.ts`) : nouveau cas vérifiant que deux métriques distinctes pour le même `conditionId` produisent deux lignes distinctes (pas de collision).

### Bug fantôme / régression — vérification

- **C10 ↔ C11** : la symétrie `+0.5` (below) / `−0.5` (above) est cohérente dans les deux fichiers ; pas de trou ni de chevauchement de bin. Le cas `target + 0.5` exact est `<=` (inclus below) et `>=` (inclus above) — compatible avec la convention demi-ouverte `[..., target + 0.5)` pour le below, `[target - 0.5, ...)` pour le above, la borne commune étant partagée sans double-compte par la CDF continue. La probabilité CDF et le booléen de résolution ne peuvent plus diverger sur un forecast exactement à `target ± 0.5`.
- **C7** : aucun consommateur ne dépendait de `proxyFallback`, pas de cascade.
- **C12** : pas de race — l'upsert s'appuie maintenant sur la clé unique élargie.

### Validation post-implémentation

- Builds : core / backtest OK.
- Tests : `forecast-distribution` (C10), `weather-exit-helpers` (C11), `weather-history-ingest` (C12) — tous verts. Aucune régression.
- Lints : 0 erreur sur les fichiers modifiés.
- Périmètre : 8 fichiers source + 1 migration + `data-source.ts` + 3 fichiers de tests + plan + `INDEX.md`, alignés sur le plan C7/C10/C11/C12.
- Vérification finale (2026-08-13) : relise du diff complet (11 fichiers modifiés + 2 nouveaux) — changements minimaux, ciblés et cohérents avec le plan. Pas de bug fantôme ni de régression silencieuse détectée.

---

## 12. Implémentation D1-D11 — purge dead code (2026-08-13)

Les constats **D1 à D11** de l'inventaire dead code (§2) ont été implémentés et vérifiés (voir [`../plans/applied/2026-08-13_PLAN-purge-dead-code-weather-algo.md`](../plans/applied/2026-08-13_PLAN-purge-dead-code-weather-algo.md)).

### Suppressions réalisées

| # | Action | Détail |
|---|--------|--------|
| **D1** | Suppression fichier | `WeatherCityGroup.tsx` (frontend, aucun importeur) |
| **D2** | Suppression fichier | `weather-grouping.ts` + `groupByCity` (frontend, aucun importeur) |
| **D3** | Retrait frontend | `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage` retirés de `api.ts` ; route backend `/coverage` + type core **conservés** (contrat API backend intact) |
| **D4** | Suppression classe | `ClockedWeatherForecastStrategy` (deprecated, aucun appelant) |
| **D5** | Retrait export | `createWeatherAdapter` + import `RunContext` inutilisé retirés de `backtest/src/index.ts` |
| **D6** | Suppression interface | `WeatherReconstructedMarket` (`context-builder.ts`) |
| **D8** | Retrait union variant | `timer` retiré de `BacktestEvent` (jamais produit ni consommé) |
| **D9** | Inline | `formatDate` no-op inlinée dans `question-builder.ts` |
| **D10** | Suppression constantes | `DEFAULT_STRATEGIES_JSON` / `DEFAULT_PARAMS_JSON` + export retirés de `strategy-catalog.ts` |
| **D11** | Suppression routes + service + janitor | 4 routes legacy (`POST /notify-changed`, `POST /`, `DELETE /:conditionId`, `PATCH /:conditionId`) + imports `publishConfigChanged`/`emitAlgoMarketsChanged`/`requireServiceToken` retirés de `weather-algo-markets.ts` ; no-op `syncMarketSelectionsForAutoTrack` + type `WeatherAutoTrackSyncResult` + import `pino`/`log` retirés de `weather-auto-track.service.ts` ; cycle janitor weather complet retiré (`auto-track-janitor.ts` supprimé + `runAutoTrackTick`/`autoTrackTimer`/`clearInterval` dans `index.ts`) |

### Décisions de scope

- **D3** : seul le frontend est nettoyé. La route backend `/coverage` et le type core `WeatherAlgoDataCoverage` restent intacts (contrat API backend).
- **D7** : réfuté — `WeatherRuntimeStatus` est une interface interne utilisée (conservée).
- **D11** : la route `POST /notify-changed` (weather) est aussi morte — le service weather-algo ne l'appelle jamais (contrairement à la version crypto-algo). Le signal de changement de config n'est pas perdu : `publishConfigChanged`/`emitAlgoMarketsChanged` sont aussi déclenchés par la route active `weather-algo-auto-track.ts`. La version crypto (`AlgoAutoTrackService.syncMarketSelectionsForAutoTrack`) est **intacte** (signature différente, active).
- **D12** : hors scope — le cross-check champ par champ de `WeatherConfig` n'a pas été fait. Audit futur dans un plan dédié.
- **D13** : réfuté — les fichiers `node_modules` ne sont pas trackés par git.

### Bug fantôme / régression — vérification

- **Aucun import cassé** : le build workspace complet (`npm run build`) compile sur les 8 packages (core, backend, worker, copy-trading, crypto-algo, weather-algo, backtest, frontend).
- **`autoTrackService`** (créé ligne 61 de `index.ts`) reste utilisé par le `strategyRunner` (ligne 158) → conservé. Seul le cycle janitor a été retiré.
- **`CONFIG_CHANGED_CHANNEL`/`redisPub`** : utilisés ailleurs dans `index.ts` (heartbeat, shutdown) → conservés. Seule la publication Redis du janitor (lignes 180-183, jamais déclenchée car `added` était toujours 0) a été retirée.
- **`getRedis`** : utilisé par `GET /status` (route conservée) → import conservé dans `weather-algo-markets.ts`.
- **`events.ts`** : fichier non tracké (nouveau) — le retrait du variant `timer` ne casse aucun switch (le `switch` de `weather-adapter.ts` a une branche `default: return;`).

### Validation post-implémentation

- **Builds** : workspace complet ✅ (8 packages).
- **Tests** : backtest **28/28** ✅, weather-algo **60/60** ✅, frontend **142/142** ✅, core **769/774** (5 échecs pré-existants hors périmètre, confirmés §10). Aucune régression.
- **Lints** : 0 erreur, 0 warning sur les fichiers modifiés.
- **Grep final** : aucun des 12 symboles supprimés ne subsiste dans `packages/`.
- **Périmètre** : 16 fichiers modifiés (10 modifiés + 3 supprimés + 3 docs), 247 suppressions, 9 insertions. Conforme au plan.

---

## 13. Implémentation T1-T7 — risques techniques (2026-08-13)

Les constats **T1 à T7** de la partie 3 (§3) ont été implémentés et vérifiés (voir [`../plans/2026-08-13_PLAN-fix-t1-t7-weather-algo.md`](../plans/2026-08-13_PLAN-fix-t1-t7-weather-algo.md)).

### T1 — `pollJob` annulable via `onCleanup`

- `WeatherAlgoHistoryIngestSection.tsx` : map `pollTokens` (keyée par city lowercased) de tokens `{ cancelled: boolean }`. `pollJob` teste `!token.cancelled` en tête de boucle **et** après chaque `await` (fetch + `setTimeout`), avant chaque `patchRow`. Un `try/finally` retire le token. `onCleanup` flip tous les tokens + vide la map → aucun `patchRow` post-unmount.

### T2 — `setInterval` stale-sweep nettoyé au shutdown

- `weather-algo-history.ts` : `createWeatherAlgoHistoryRouter` retourne `Router & { cleanup: () => void }` via `Object.assign(router, { cleanup })` ; `cleanup = () => clearInterval(staleSweep)`.
- `index.ts` : le routeur est stocké dans `weatherAlgoHistoryRouter`, `weatherAlgoHistoryRouter.cleanup()` appelé dans `shutdown` (après `stopRealAutoSnapshotLoop`). `unref()` conservé.

### T3 — `JSON.parse(row.modelValues)` protégé

- `weather-forecast.service.ts` : `getCached` enveloppe `JSON.parse` dans un `try/catch` ; en cas d'échec → `log.warn` (city/forecastDate/metric/err) + `return null` (fail-safe). Le fetch frais est déclenché par `getOrFetch` ; `weather-entry-pipeline` skip (déjà fail-open).

### T4 — Guard `target` nullable dans `computeMarketImpliedProbabilities`

- `forecast-distribution.ts` : les branches `or_below`/`or_above`/`exact` passent par un guard `if (target == null || !Number.isFinite(target)) return { yesProb: 0, noProb: 1 }` → plus d'assertion `!` (NaN silencieux éliminé). `between` inchangé (géré avant le guard, fallback `target ?? 0` conservé). `evaluateBucketGate` abstient avec `zero_forecast_probability`.
- **Tests** : 5 nouveaux cas dans `forecast-distribution.test.ts` (null/NaN pour les 3 comparisons + `between` avec bounds).

### T5 — `onMount` au lieu de side-effect en render

- `WeatherAlgoStrategiesTab.tsx` et `WeatherAlgoSettingsTab.tsx` : `if (!loaded()) void load()` → `onMount(() => void load())` / `onMount(() => void loadConfig())`. Le signal `loaded` reste mis à jour.

### T6 — `saveIfAbsent` atomique via `ON CONFLICT DO NOTHING`

- `weather-position-forecast.service.ts` : `saveIfAbsent` réécrit avec `repo.createQueryBuilder().insert().into(...).values(...).onConflict('("copied_position_id") DO NOTHING').execute()` ; retourne `(result.raw?.length ?? 0) === 1`. Supprime le check-then-insert et le catch re-`findOne`. S'appuie sur l'unique index `IDX_weather_pos_forecast_position_id` (migration 0081). Imports `pino`/`log` devenus inutiles → retirés.
- **Tests** : `weather-position-forecast.service.test.ts` réécrit pour mocker `createQueryBuilder` (retour `raw` par référence mutable) — 3 cas (idempotent, insert true, conflict false).

### T7 — Skip `markClosed` si `pos.city` est null

- `exit-manager.ts` : `this.markClosed(pos.city ?? '', now)` → `if (pos.city) { this.markClosed(pos.city, now) }`. Évite la collision de clé `''` (throttle faux-positif sur les positions sans ville). `isReentryBlocked(undefined)` retourne déjà `false` côté adapter → cohérent.
- **Tests** : 2 nouveaux cas dans `exit-manager.test.ts` (position sans ville non throttlée + régression position avec ville).

### Validation post-implémentation

- **Builds** : core, backtest, backend, frontend — **OK** (tous les packages concernés compilent).
- **Tests** :
  - core : `forecast-distribution` **15/15** (5 nouveaux T4), `weather-position-forecast` **3/3** (réécrit T6), `weather-forecast` **2/2** (2 nouveaux T3) — 20/20 sur les modules modifiés.
  - backtest : `exit-manager` **7/7** (2 nouveaux T7), `weather-adapter` **8/8** — aucune régression.
  - weather-algo : `weather-entry-pipeline` **13/13** (mock `saveIfAbsent` compatible).
- **Lints** : 0 erreur sur tous les fichiers modifiés.
- **Périmètre** : 9 fichiers source + 3 tests + 2 docs (plan + audit). Conforme au plan.

### Reste à faire en prod

- Aucune migration nécessaire (T6 s'appuie sur l'unique index existant).
- Smoke test : backend `GET /api/weather-algo-history/jobs` répond toujours ; timer stale-sweep annulé au SIGTERM/SIGINT ; UI — unmount pendant un poll d'ingest sans warning console post-unmount ; onglets Stratégies / Paramètres chargent au mount.

---

## 14. Implémentation R1-R10 — refactors / simplification (2026-08-13)

Les constats **R1, R2, R3, R5, R6, R7, R8, R9, R10** de la partie 4 (§4) ont été implémentés et vérifiés (voir [`../plans/applied/2026-08-13_PLAN-refactor-weather-algo-r1-r10.md`](../plans/applied/2026-08-13_PLAN-refactor-weather-algo-r1-r10.md)). **R4** était déjà implémenté (résolu par C2, §9).

### R1 — Agrégateur timeline commun

- `weather-algo-data.service.ts` : extraction de `buildTimelineCities` (interfaces `TimelineRowLike`/`TimelineCityLike`/`TimelineBucketLike`). `getBucketTicksTimeline` et `getClobPriceHistoryTimeline` partagent la boucle d'accumulation `Map<conditionId, bucket>` par ville + la projection `Map → tableau` trié. Le query builder (filtres, tri, LIMIT) reste propre à chaque méthode.
- Le guard `!cityKey` (falsy) est centralisé — sans impact sur clob (`city` non-nullable) ni sur bucket-ticks (guard identique à l'original).

### R2 — Split `WeatherAlgoDataTab.tsx`

- `WeatherAlgoDataTableId` dérivé de l'array `WEATHER_ALGO_DATA_TABLE_IDS` (`(typeof ...)[number]`) dans `ui-persistence.ts` ; `api.ts` l'importe (suppression de la 2e source).
- Rows typées en union `WeatherAlgoDataRow` (7 shapes) ; `DetailRow` conserve l'accès dynamique par clé via un cast `as unknown as Record<string, unknown>`.
- Composant `Pagination` partagé utilisé (prop `showIfSingle`).

### R3 — Consolider `WeatherAlgoBacktestTab.tsx` + `EXIT_REASON_LABEL` typeorm-free

- `FALLBACK_STRATEGIES` extrait ; formatters consolidés via `lib/format.ts` ; `Pagination` partagé.
- `EXIT_REASON_LABEL`/`BACKTEST_EXIT_REASONS`/`BacktestExitReason` extraits dans `packages/core/src/backtest/backtest-exit-reasons.ts` (sans dépendance typeorm).
- **Bug corrigé** : le re-export via `entities/BacktestPosition.ts` (qui importe typeorm) tirait typeorm dans le bundle frontend → `Uncaught SyntaxError: ... does not provide an export named 'Buffer'`. Corrigé par un re-export direct de `backtest-exit-reasons.js` dans `packages/core/src/index.ts` + sous-chemin d'export `./backtest/exit-reasons` dans `package.json` + import frontend depuis ce sous-chemin + ajout à `optimizeDeps.include` de `vite.config.ts`.

### R5 — Nettoyage `weather-market-discovery.ts`

- Bloc debug Paris supprimé (logs `parisMarkets`/`parisHighestTempJuly25` + boucle de debug).
- `maxPages` configurable via paramètres (`discoverWeatherMarkets`, `discoverResolvedWeatherMarkets`, `DiscoverWeatherMarketsInRangeOptions`) ; défaut = `MAX_PAGES`/`MAX_RANGE_PAGES` → aucun changement en régime nominal.
- Tri Paris-first extrait dans `compareCityGroups` (Paris en premier, « Autres » en dernier, puis alphabétique).

### R6 — Helpers routes partagés

- `packages/backend/src/routes/lib/query-params.ts` : `parseLimit`/`parseOffset`/`parseOptionalDate`.
- Les 3 routes (`backtest.ts`, `weather-algo-data.ts`, `algo-optimize-report.ts`) importent les helpers partagés. `parseOptionalDate` unifié en `Date | undefined` (compatible avec `loadCryptoAlgoOptimizeReport` qui accepte `Date | null | undefined`).

### R7 — Tableau watched-cities partagé

- `WeatherWatchedTable` (slot `renderHorizon`) utilisé par `WeatherAlgoActiveMarketsPanel` (horizon statique `J+N`) et `WeatherAlgoAutoTrackTab` (input éditable). `emptyText` passé en prop (`JSX.Element`).

### R8 — Formatters consolidés

- `packages/frontend/src/lib/format.ts` : `formatCents`/`formatTs`/`formatTsCompact`/`formatNum`/`formatPollInterval`. `formatNum` gère `Infinity` (retourne `∞`). Consommateurs migrés (`WeatherAlgoDataTab`, `WeatherAlgoBacktestTab`, `WeatherTimelineView`, `WeatherSeriesLegend`).

### R9 — `FIDELITY_OPTIONS` source unique

- `packages/frontend/src/lib/fidelity-options.ts` (`value: string`). Les 3 copies (`WeatherAlgoHistoryIngestSection` avec `value: number`, `WeatherBucketTimelineView`/`WeatherClobTimelineView` avec `value: string`) sont unifiées. Compatible avec `WeatherTimelineSideOption` (`value: string`) et les consommateurs (`Number(...)`/`String(...)`).

### R10 — Split `evaluateExits()`

- `weather-adapter.ts` : `evaluateExits` décomposé en `currentForecastMean` (retourne `number | null`), `tryResolvePosition` (tri-state `'resolved' | 'skip' | 'fallthrough'`) et `tryExitByDecision` (n'appelle `evaluate` qu'une seule fois — side-effects `markClosed`/hysteresis préservés). Type `LedgerPosition` importé.

### Bug fantôme / régression — vérification

- **R1** : le guard `!cityKey` centralisé ne change pas le comportement clob (`city` non-nullable) ni bucket-ticks (guard identique).
- **R3** : le frontend n'importe plus typeorm via `EXIT_REASON_LABEL` (sous-chemin typeorm-free). Le backend continue d'importer depuis le point d'entrée.
- **R8** : `formatNum` a un défaut `digits=3` ; tous les appels de `WeatherAlgoBacktestTab` passent un `digits` explicite, `WeatherAlgoDataTab` utilise le défaut `3` identique à l'ancien.
- **R9** : le passage `value: number` → `value: string` est sans impact (les consommateurs utilisent `Number(...)`/`String(...)`).
- **R10** : le tri-state reproduit le flux original (`continue` sur résolution/skip, `fallthrough` vers la décision).

### Validation post-implémentation

- **Builds** : core, backtest, backend, frontend — **OK** (`tsc --noEmit`).
- **Tests** :
  - core : `weather-algo-data.service` **18/18** (R1), `weather-market-discovery` **19/19** (R5). 5 échecs pré-existants hors périmètre (confirmés §10).
  - backtest : **30/30**, dont `weather-adapter` **8/8** (R10).
- **Lints** : 0 erreur sur les fichiers modifiés.
- **Grep final** : `EXIT_REASON_LABEL` importé par le frontend depuis `@polywatch/core/backtest/exit-reasons` (typeorm-free).
- **Périmètre** : 25 fichiers (4 nouveaux modules core/backend + 4 nouveaux composants/libs frontend + 17 modifiés). Conforme au plan.

### Reste à faire en prod

- Redémarrer le serveur Vite (ou vider `node_modules/.vite`) pour que le pré-bundling prenne en compte le nouveau sous-chemin `@polywatch/core/backtest/exit-reasons`.
- Smoke test UI : onglet Backtest (raisons de sortie affichées), onglet Données (pagination, rows typées), timelines bucket/clob (fidélité), panneaux watched-cities.

---