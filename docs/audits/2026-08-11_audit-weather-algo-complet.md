# Audit — Weather Algo (complet)

- **Date** : 2026-08-11
- **Type** : audit read-only de la partie weather algo (aucun fichier corrigé)
- **Périmètre** : package `backtest`, package `core` (services + `weather/` + migrations), routes backend `weather-algo-*.ts` + `backtest.ts`, frontend (components / hooks / lib / api), documentation (`weather-algo.md`, `api.md`, `backtest.md`, `modele-donnees.md`)
- **Méthode** : chaque constat préliminaire du plan a été **confirmé ou réfuté par lecture directe du code** (extraits et lignes cités pour traçabilité)

> Les corrections feront l'objet d'un plan distinct après validation de ce rapport.

---

## 1. Conflits de logique / cohérence

| # | Constat | Localisation | Sévérité | Implémenté |
|---|---------|--------------|----------|------------|
| **C1** | `getOrFetch` retourne `isFresh: false` (ligne 101) alors que la route `weather-algo-forecasts.ts` met `true` (ligne 68). Le service persisté avec `isFresh:true` (ligne 92) est renvoyé `isFresh:false` → flag sémantiquement incohérent pour tout appel via `getOrFetch`. | `weather-forecast.service.ts:95-103` vs `weather-algo-forecasts.ts:68` | 🔴 Critique | ✅ |
| **C2** | `bucketLabel` tripliqué avec unités divergentes : `°C` dans `lib/weather-position.ts` (lignes 34-42) vs `°` dans `WeatherBucketTimelineView.tsx:32` et `WeatherClobTimelineView.tsx:41`. Le suffixe est codé en dur et ne reflète pas l'unité réelle du marché. | 3 fichiers frontend | 🔴 Critique | ✅ |
| **C3** | `VALID_TABLE_IDS` (route `weather-algo-data.ts:6-14`) duplique `WeatherAlgoDataTableId` (service `weather-algo-data.service.ts:14-21`). Toute nouvelle table impose 2 edits manuels. | route vs service | 🟠 Haute | — |
| **C4** | Restrictions `metric` inconsistantes (voir matrice §1.1) : `question-builder` ne supporte que `highest_temp`/`lowest_temp` ; `weather-forecast.service` accepte `string` libre ; les routes valident un enum strict ; les tests seedent `metric: 'temp'`. | multiple | 🟠 Haute | — |
| **C5** | `parseExitReason` (route `backtest.ts`) hardcode une liste qui duplique l'union `BacktestExitReason` core → drift si une nouvelle raison est ajoutée. | route `backtest.ts` | 🟠 Haute | — |
| **C6** | `weather-algo-forecasts.ts` re-implémente cache-then-fetch (lignes 36-74) au lieu d'appeler `getOrFetch` → **divergence** avec le service : la route met `isFresh: true` (correct) tandis que `getOrFetch` (C1) retourne `isFresh: false` pour le même forecast frais. La duplication ne reproduit pas le bug de C1, elle crée deux chemins incohérents. | route | 🟠 Haute | ✅ |
| **C7** | `proxyFallback` toujours `true` dans `resolution.ts` (lignes 25, 34) — champ retourné mais jamais consommé. | `resolution.ts` | 🟡 Moyenne | — |
| **C8** | ⚠️ **Réfuté** : la migration `SplitRiskConfigPerAlgoKind1700000000087` (lignes 240-293) crée bien `weather_config`. Le « renommage » `risk_config→weather_config` est en réalité une **copie** `INSERT INTO ... SELECT FROM risk_config` (lignes 682-768) puis `DropLegacyRiskConfig1700000000088` supprime l'ancienne table. Pas de bug réel. | migrations `0087` / `0088` | ⚪ Résolu | N/A |
| **C9** *(nouveau)* | ⚠️ **Réfuté** : la branche `?? {}` ligne 291 de `getStrategyParams` **est atteignable**. `parseWeatherAlgoStrategyParams(...)` retourne bien toujours un objet, mais l'indexation `[strategyId]` sur la map renvoie `undefined` quand la clé est absente — c'est précisément le cas que `?? {}` couvre. Le constat confondait le retour de la fonction (toujours un objet) avec l'accès indexé (peut être `undefined`). Pas de bug. | `strategy-catalog.ts:291` | ⚪ Résolu | N/A |
| **C10** *(nouveau)* | Asymétrie de bin CDF : `computeCdfBelow(target)` = `normalCDF(target)` (aucun décalage de bin) alors que `computeCdfAbove(target)` = `1 - normalCDF(target - 0.5)`. Pour un marché « or_below » (`P(temp <= X)`) vs « or_above » (`P(temp >= X)`), les deux probabilités YES n'utilisent pas la même convention → trou de 0.5 °C. | `forecast-distribution.ts:49-71` | 🔴 Critique | — |
| **C11** *(nouveau)* | Asymétrie de tolérance `isForecastInBucket` : `between`/`exact` utilisent `±0.5` (lignes 42, 46) mais `or_below`/`or_above` n'ont aucune tolérance (lignes 50, 54) → un forecast mean à la limite est classé différemment selon le type de bucket. | `weather-exit-helpers.ts:38-58` | 🟡 Moyenne | — |
| **C12** *(nouveau)* | L'index unique d'`upsertPoints` couvre `condition_id, side, recorded_at, fidelity_minutes` mais **pas `metric`** (lignes 657-664) — deux séries de métriques différentes sur le même `condition_id` s'écraseraient. Commenté « sans risque » car un `condition_id` a une métrique fixe, mais reste fragile. | `weather-history-ingest.service.ts:657-664` | 🟡 Moyenne | — |

### 1.1 Matrice de cohérence `metric` (C4)

| Couche | Valeurs autorisées | Fichier |
|--------|-------------------|---------|
| `question-builder` (synthèse question) | `highest_temp` / `lowest_temp` uniquement | `question-builder.ts:33` |
| `weather-forecast.service.getOrFetch` | `'highest_temp' \| 'lowest_temp' \| string` (string libre) | `weather-forecast.service.ts:42` |
| Route `weather-algo-forecasts` | enum strict `['highest_temp','lowest_temp']` | `weather-algo-forecasts.ts:16` |
| Route `weather-algo-history` (ingest) | enum strict | `weather-algo-history.ts:15` |
| `WeatherAutoTrackService.addRule` | `string = 'highest_temp'` (default, non restreint) | `weather-auto-track.service.ts:27` |
| Tests core | `metric: 'temp'` | tests `weather-algo-data.service.test.ts` |
| Entité / DB | `string` (colonne TEXT) | `WeatherAutoTrackRule` |

**Conclusion** : seule la route forecasts valide strictement. Le service accepte `string` libre mais masque le risque via `metric as 'highest_temp'|'lowest_temp'` (ligne 62). Les tests utilisent une valeur (`temp`) absente des enums de routes → incohérence de données possibles.

---

## 2. Inventaire dead code

| # | Élément | Localisation | Vérifié | Recommandation | Implémenté |
|---|---------|--------------|---------|----------------|------------|
| D1 | `WeatherCityGroup.tsx` (composant générique) | frontend | ✅ aucun importeur | Supprimer | — |
| D2 | `lib/weather-grouping.ts` + `groupByCity` | frontend | ✅ aucun importeur | Supprimer (récupérer si besoin pour tests) | — |
| D3 | `fetchWeatherAlgoDataCoverage` + `WeatherAlgoDataCoverage` | `api.ts:644,810` | ✅ aucun appelant | Supprimer | — |
| D4 | `ClockedWeatherForecastStrategy` (deprecated) | `clocked-weather-strategy.ts:70-74` | ✅ aucun appelant | Supprimer | — |
| D5 | `createWeatherAdapter` export | `backtest/src/index.ts:75-77` | ✅ aucun consommateur | Supprimer | — |
| D6 | `WeatherReconstructedMarket` interface | `context-builder.ts:6-13` | ✅ inutilisée | Supprimer | — |
| D7 | ⚠️ **Réfuté** : `WeatherRuntimeStatus` est une **interface interne utilisée** (lecture lignes 57, 60), pas un export mort | `weather-algo-markets.ts:11` | ❌ PAS dead code | Conserver | N/A |
| D8 | Variant `timer` dans `BacktestEvent` | `events.ts:62` | ✅ jamais produit/consommé | Supprimer (union) | — |
| D9 | `formatDate` no-op dans question-builder | `question-builder.ts:10-14` | ✅ retourne l'input tel quel | Inliner / supprimer | — |
| D10 | `DEFAULT_STRATEGIES_JSON` / `DEFAULT_PARAMS_JSON` | `strategy-catalog.ts:227-228,366` | ✅ exports, aucun import | Supprimer | — |
| D11 | Routes legacy : `POST /` (no-op 410), `syncMarketSelectionsForAutoTrack` (no-op) — mais `DELETE /:conditionId` et `PATCH /:conditionId` (204/200) **ne sont pas de pures no-op** : elles émettent des side-effects event-bus (`publishConfigChanged` / `emitAlgoMarketsChanged`). | `weather-algo-markets.ts:88-108`, `weather-auto-track.service.ts:85-87` | ✅ | Supprimer `POST /` et `syncMarketSelectionsForAutoTrack` ; conserver `DELETE`/`PATCH` ou réimplémenter proprement si les events sont utiles | — |
| D12 | Champs `WeatherConfig` non lus par le frontend (~30 legacy) | `api.ts` | ⚠️ non vérifié en profondeur (cross-check champ par champ non fait) | Documenter / nettoyer | — |
| D13 | ⚠️ **Réfuté** : `git ls-files "node_modules/@polywatch/*/node_modules/.vite/vitest/*"` ne retourne **aucun fichier**. Les fichiers `node_modules` ne sont pas trackés par git. Constat initial faux (probable confusion avec le `git status` non-tracké du working dir). | `node_modules/...` | ⚪ Résolu | N/A | N/A |

---

## 3. Risques techniques

| # | Constat | Localisation | Sévérité | Implémenté |
|---|---------|--------------|----------|------------|
| T1 | `pollJob` `while(true)` sans `onCleanup` → `patchRow` (setState) sur composant unmounté + fuite | `WeatherAlgoHistoryIngestSection.tsx:180-203` | 🔴 Critique | — |
| T2 | `setInterval` stale-sweep jamais nettoyé (leak sur hot-reload) ; seul `unref()` est appliqué | `weather-algo-history.ts:29-34` | 🟠 Haute | — |
| T3 | `JSON.parse(row.modelValues)` sans try/catch → crash de `getCached` si JSON corrompu | `weather-forecast.service.ts:124` | 🟠 Haute | — |
| T4 | Assertions `!` sur `target` nullable (`target!`) → si `target` est `null`, `normalCDF(NaN)` → NaN silencieux | `forecast-distribution.ts:105,109,115-116` | 🟠 Haute | — |
| T5 | Side-effects en render (`if (!loaded()) void load()`) | StrategiesTab / SettingsTab | 🟡 Moyenne | — |
| T6 *(nouveau)* | `WeatherPositionForecastService.saveIfAbsent` fait un `findOne` puis un `save` non atomique ; le catch gère la concurrence mais pas l'upsert race | `weather-position-forecast.service.ts:37-64` | 🟡 Moyenne | — |
| T7 *(nouveau)* | `markClosed(pos.city ?? '')` — le throttle de ré-entrée est keyé sur `''` pour les positions sans ville | `exit-manager.ts:151` | 🟡 Moyenne | — |

---

## 4. Besoins de refactor / simplification

| # | Refactor | Fichier | Effort | Implémenté |
|---|----------|---------|--------|------------|
| R1 | Extraire l'agrégateur timeline commun (dup ~100 lignes entre `getBucketTicksTimeline` et `getClobPriceHistoryTimeline`) | `weather-algo-data.service.ts:391-664` | 2h | — |
| R2 | Split `WeatherAlgoDataTab.tsx` 906 lignes (rows non typées, 3 sources de table IDs) | frontend | 3h | — |
| R3 | Consolider `WeatherAlgoBacktestTab.tsx` 729 lignes (fallback strategy hardcoded, formatters dupliqués, `EXIT_REASON_LABEL` inline, 3 cadences poll) | frontend | 3h | — |
| R4 | Extraire `formatBucketLabel` unifié (résout C2) | 3 fichiers | 1h | ✅ |
| R5 | Nettoyer `weather-market-discovery.ts` (debug Paris lignes 99-119, magic numbers `MAX_PAGES`/`MAX_RANGE_PAGES`, tri Paris-first) | core | 1h | — |
| R6 | Consolider helpers routes (`parseLimit` / `parseOffset` / `parseOptionalDate`) | routes | 1h | — |
| R7 | Factoriser le tableau watched-cities (ActiveMarketsPanel + AutoTrackTab) | frontend | 1h | — |
| R8 | Consolider formatters (`formatTs`/`formatNum`/`formatCents`/`formatPollInterval`) dans `lib/format.ts` | frontend | 1h | — |
| R9 | Unifier `FIDELITY_OPTIONS` (3 copies, shapes `string` vs `number`) | 3 fichiers | 30 min | — |
| R10 | Split `evaluateExits()` ~120 lignes dans l'adapter (résout la duplication `getCurrentForecast` ×2) | `weather-adapter.ts:553-671` | 1h | — |

---

## 5. Doc vs code

| # | Constat | Doc | Sévérité | Implémenté |
|---|---------|-----|----------|------------|
| F1 | 2 routes data manquantes : `DELETE /tables/:id` (route `weather-algo-data.ts:189`) et `GET /weather-algo-history/jobs` (route `weather-algo-history.ts:64`). ⚠️ **Corrigé** : la version initiale listait 6 routes manquantes, mais `/bucket-ticks/timeline`, `/clob-price-history/timeline` et `DELETE /bucket-ticks/interval` sont **déjà documentées** (`api.md:400-402`). | `api.md:390-416` | 🟡 Moyenne | — |
| F2 | Param `fidelityMinutes` backtest omis dans la liste des paramètres de run (`api.md:440`) — pourtant documenté dans `backtest.md:110` | `api.md` | 🟡 Moyenne | — |
| F3 | Wording « 6 tables » stale (le code renvoie 7 avec `clob_price_history`) | `api.md:392-393`, `plans/applied/2026-08-08_IMPL-...:57-58` | 🟢 Faible | — |
| F4 | Code warning `kill_switch_partial_close` manquant dans le tableau des warnings | `backtest.md:85-93` | 🟢 Faible | — |
| F5 | ⚠️ **Réfuté** : les cross-refs `docs/code/08-weather-algo.md`, `configuration.md`, `plans/applied` existent toutes ; `weather-config-api.ts` et `policy.ts` référencés par `weather-algo.md` existent aussi. Le package `packages/weather-algo/` **existe et est tracké par git** (27 fichiers, dont `package.json`, `src/index.ts`, `src/strategy/weather-forecast.strategy.ts`) ; il est importé par `@polywatch/weather-algo` (ex. `clocked-weather-strategy.ts:6`). Le constat initial (cross-refs manquantes) est donc réfuté. *(Correction 2026-08-12 : la version précédente indiquait à tort que le dossier n'apparaissait pas dans git status — confusion entre fichiers non-trackés du working dir et fichiers déjà trackés/committés.)* | multiple | ⚪ Résolu | N/A |

---

## 6. Synthèse par sévérité

**🔴 Critique (4)** : C1 (✅ implémenté), C2 (✅ implémenté), C10 (asymétrie CDF), T1 (leak `pollJob`). → **reste 2 actifs** : C10, T1.

**🟠 Haute (8)** : C3, C4, C5, C6 (✅ implémenté), T2, T3, T4, C12 (race upsert). → **reste 7 actifs**.

**🟡 Moyenne (7)** : C7, C11, T5, T6, T7, F1, F2 (+ tous les refactors R1-R10 comme dette).

**🟢 Faible (13)** : F3, F4, D1, D2, D3, D4, D5, D6, D8, D9, D10, D11, D12.

**Réfutations (5)** : C8 (migration existe), C9 (`?? {}` atteignable), D7 (`WeatherRuntimeStatus` utilisé), D13 (node_modules non trackés), F5 (cross-refs résolues).

---

## 7. Recommandations prioritaires

1. **C1 + C6** : unifier la logique cache/fetch dans `WeatherForecastService` (appeler `getOrFetch` depuis la route) et corriger le flag `isFresh` du retour après fetch. ✅ **Fait** (2026-08-12).
2. **T1** : rendre `pollJob` annulable via `onCleanup` (flag local + garde sur le composant monté).
3. **C10 + C11** : aligner les conventions de bin (`or_below` / `or_above` / `exact` / `between`) et les tolérances `isForecastInBucket`.
4. **R4 (C2)** : extraire un `formatBucketLabel(unit)` unique et propager l'unité du marché (C vs F). ✅ **Fait** (2026-08-12).
5. **T3** : encadrer `JSON.parse(row.modelValues)` d'un try/catch.
6. **F1-F4** : mettre à jour `api.md` / `modele-donnees.md` / `backtest.md`.
7. **D1-D12** : purger le dead code selon l'inventaire §2 (D13 réfuté — les fichiers `node_modules` ne sont pas trackés par git, aucune action gitignore nécessaire).

Aucun fichier n'a été modifié pendant cet audit (hors suivi d'implémentation en §8).

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

Synthèse mise à jour : 4 constats critiques, 8 hauts, 7 moyens, 13 faibles, 5 réfutations. Aucune question de comportement n'était nécessaire — toutes les corrections découlent directement de la lecture du code. **Implémentation** : C1, C2 et C6 sont implémentés (statut `✅` dans les tableaux §1) ; R4 est implémenté (statut `✅` dans le tableau §4).

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
- Rollback `npm run migrate:revert`.

**Impact sur la synthèse §6** : C1, C2 et C6 sont désormais corrigés. Actifs restants — 2 critiques (C10, T1), 7 hauts (C3, C4, C5, T2, T3, T4, C12), 7 moyens, 13 faibles.
