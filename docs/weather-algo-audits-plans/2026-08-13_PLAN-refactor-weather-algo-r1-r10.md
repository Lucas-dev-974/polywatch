# Plan — Partie 4 : Refactor / simplification (R1–R10)

- **Date** : 2026-08-13
- **Statut** : ✅ implémenté (2026-08-13)
- **Scope** : `packages/core`, `packages/backtest`, `packages/backend`, `packages/frontend`
- **Référence** : [`2026-08-11_audit-weather-algo-complet.md`](./2026-08-11_audit-weather-algo-complet.md) (§4 « Besoins de refactor / simplification », R1–R10)

**Objectif** : implémenter les refactors R1–R10 identifiés à l'audit weather-algo (partie 4). R4 était déjà implémenté (résolu par C2, §9 de l'audit) ; ce plan couvre R1, R2, R3, R5, R6, R7, R8, R9, R10.

> ⚠️ **Périmètre** : ce plan traite **uniquement** les refactors de la §4. Les constats de logique (C1–C12, §1), le dead code (D1–D13, §2) et les risques techniques (T1–T7, §3) sont hors scope (plans dédiés).

---

## 1. Décisions de design

| R | Refactor | Choix | Détail |
|---|----------|-------|--------|
| **R1** | Extraire l'agrégateur timeline commun | Extraire **la boucle d'accumulation + la projection** (pas le query builder) dans `buildTimelineCities` | Les deux timelines (`getBucketTicksTimeline`, `getClobPriceHistoryTimeline`) partagent la même boucle `Map<conditionId, bucket>` par ville + la projection `Map → tableau` trié. Seuls diffèrent : la clé ville, l'init/update de la ville (forecastMean/StdDev pour bucket-ticks), le mapper point et l'init du bucket. Le query builder (filtres, tri, LIMIT) reste propre à chaque méthode. Le guard `!cityKey` (falsy) est centralisé — sans impact sur clob (`city` non-nullable) ni sur bucket-ticks (guard identique à l'original). |
| **R2** | Split `WeatherAlgoDataTab.tsx` | Dériver `WeatherAlgoDataTableId` de l'array `WEATHER_ALGO_DATA_TABLE_IDS` ; typer les rows en union `WeatherAlgoDataRow` ; utiliser le composant `Pagination` partagé | Suppression de la 2e source de table IDs (l'audit en annonçait 3, la re-vérification en a trouvé 2). Les rows passent de `Record<string, unknown>[]` à une union typée. `DetailRow` conserve l'accès dynamique par clé via un cast `as unknown as Record<string, unknown>` (chaque table a sa propre shape, le rendu est piloté par `id`). |
| **R3** | Consolider `WeatherAlgoBacktestTab.tsx` | Extraire `FALLBACK_STRATEGIES` ; consolider les formatters via `lib/format.ts` ; extraire `EXIT_REASON_LABEL` dans un module typeorm-free ; utiliser `Pagination` | L'audit annonçait « 3 cadences poll » — la re-vérification en a trouvé **1** (constante `POLL_MS`). `EXIT_REASON_LABEL` est extrait dans `packages/core/src/backtest/backtest-exit-reasons.ts` (sans dépendance typeorm) et importé par le frontend via le sous-chemin `@polywatch/core/backtest/exit-reasons` pour ne pas tirer typeorm dans le bundle navigateur. |
| **R5** | Nettoyer `weather-market-discovery.ts` | Supprimer le bloc debug Paris ; rendre `MAX_PAGES`/`MAX_RANGE_PAGES` configurables via paramètres ; extraire `compareCityGroups` | Le tri Paris-first est extrait dans `compareCityGroups` (Paris en premier, « Autres » en dernier, puis alphabétique). `maxPages` est ajouté aux options de `discoverWeatherMarkets`, `discoverResolvedWeatherMarkets` et `DiscoverWeatherMarketsInRangeOptions` (défaut = constantes existantes → aucun changement en régime nominal). |
| **R6** | Consolider helpers routes | Créer `packages/backend/src/routes/lib/query-params.ts` (`parseLimit`/`parseOffset`/`parseOptionalDate`) | Les 3 routes (`backtest.ts`, `weather-algo-data.ts`, `algo-optimize-report.ts`) importent les helpers partagés. `parseOptionalDate` est unifié en `Date \| undefined` (compatible avec `loadCryptoAlgoOptimizeReport` qui accepte `Date \| null \| undefined`). |
| **R7** | Factoriser le tableau watched-cities | Créer `WeatherWatchedTable` partagé avec slot `renderHorizon` | `WeatherAlgoActiveMarketsPanel` et `WeatherAlgoAutoTrackTab` partagent le tableau. Seule la cellule « Horizon » diffère (statique `J+N` vs input éditable) via le slot `renderHorizon`. Le contenu du bloc vide (`emptyText`) est passé en prop (`JSX.Element`). |
| **R8** | Consolider formatters | Créer `packages/frontend/src/lib/format.ts` (`formatCents`/`formatTs`/`formatTsCompact`/`formatNum`/`formatPollInterval`) | `formatNum` gère `Infinity` (retourne `∞`). Les consommateurs (`WeatherAlgoDataTab`, `WeatherAlgoBacktestTab`, `WeatherTimelineView`, `WeatherSeriesLegend`) importent les helpers partagés. |
| **R9** | Unifier `FIDELITY_OPTIONS` | Créer `packages/frontend/src/lib/fidelity-options.ts` (source unique, `value: string`) | Les 3 copies (`WeatherAlgoHistoryIngestSection` avec `value: number`, `WeatherBucketTimelineView`/`WeatherClobTimelineView` avec `value: string`) sont unifiées sur `value: string`, compatible avec `WeatherTimelineSideOption` (`value: string`) et les consommateurs qui utilisent `Number(...)`/`String(...)`. |
| **R10** | Split `evaluateExits()` | Extraire `currentForecastMean`/`tryResolvePosition`/`tryExitByDecision` | `tryResolvePosition` retourne un tri-state `'resolved' \| 'skip' \| 'fallthrough'` (résolution, skip sans forecast, ou fallthrough vers la décision). `tryExitByDecision` n'appelle `evaluate` qu'une seule fois (side-effects `markClosed`/hysteresis préservés). `currentForecastMean` retourne `number \| null` (fallback snapshot). |

---

## 2. Fichiers touchés

| Fichier | Changement | R |
|---------|------------|---|
| `packages/core/src/services/weather-algo-data.service.ts` | Extraire `buildTimelineCities` (interfaces `TimelineRowLike`/`TimelineCityLike`/`TimelineBucketLike`) ; `getBucketTicksTimeline`/`getClobPriceHistoryTimeline` l'utilisent | R1 |
| `packages/core/src/weather/weather-market-discovery.ts` | Supprimer le debug Paris ; `maxPages` configurable ; extraire `compareCityGroups` | R5 |
| `packages/backend/src/routes/lib/query-params.ts` *(nouveau)* | Helpers `parseLimit`/`parseOffset`/`parseOptionalDate` | R6 |
| `packages/backend/src/routes/backtest.ts` | Importer les helpers partagés (suppression des définitions locales) | R6 |
| `packages/backend/src/routes/weather-algo-data.ts` | Importer les helpers partagés (suppression des définitions locales) | R6 |
| `packages/backend/src/routes/algo-optimize-report.ts` | Importer `parseOptionalDate` (unifié `Date \| undefined`) | R6 |
| `packages/core/src/backtest/backtest-exit-reasons.ts` *(nouveau)* | `BACKTEST_EXIT_REASONS`/`EXIT_REASON_LABEL`/`BacktestExitReason` typeorm-free | R3 |
| `packages/core/src/entities/BacktestPosition.ts` | Re-export depuis `backtest-exit-reasons.ts` | R3 |
| `packages/core/src/entities/index.ts` | Re-export `EXIT_REASON_LABEL` | R3 |
| `packages/core/src/index.ts` | Re-export direct de `backtest-exit-reasons.js` (chemin typeorm-free) | R3 |
| `packages/core/package.json` | Sous-chemin d'export `./backtest/exit-reasons` | R3 |
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | Split `evaluateExits` en `currentForecastMean`/`tryResolvePosition`/`tryExitByDecision` ; type `LedgerPosition` | R10 |
| `packages/frontend/src/lib/format.ts` *(nouveau)* | Formatters partagés | R8 |
| `packages/frontend/src/lib/fidelity-options.ts` *(nouveau)* | `FIDELITY_OPTIONS` source unique | R9 |
| `packages/frontend/src/components/Pagination.tsx` *(nouveau)* | Pagination partagée (prop `showIfSingle`) | R2/R3 |
| `packages/frontend/src/components/WeatherWatchedTable.tsx` *(nouveau)* | Tableau watched-cities partagé (slot `renderHorizon`) | R7 |
| `packages/frontend/src/components/WeatherAlgoDataTab.tsx` | Type `WeatherAlgoDataTableId` importé de `ui-persistence` ; rows typées `WeatherAlgoDataRow` ; `Pagination` ; formatters importés | R2/R8 |
| `packages/frontend/src/components/WeatherAlgoBacktestTab.tsx` | `FALLBACK_STRATEGIES` ; formatters importés ; `EXIT_REASON_LABEL` importé du sous-chemin typeorm-free ; `Pagination` | R3/R8 |
| `packages/frontend/src/components/WeatherAlgoActiveMarketsPanel.tsx` | Utilise `WeatherWatchedTable` | R7 |
| `packages/frontend/src/components/WeatherAlgoAutoTrackTab.tsx` | Utilise `WeatherWatchedTable` | R7 |
| `packages/frontend/src/components/WeatherAlgoHistoryIngestSection.tsx` | `FIDELITY_OPTIONS` importé | R9 |
| `packages/frontend/src/components/WeatherBucketTimelineView.tsx` | `FIDELITY_OPTIONS` importé | R9 |
| `packages/frontend/src/components/WeatherClobTimelineView.tsx` | `FIDELITY_OPTIONS` importé | R9 |
| `packages/frontend/src/components/WeatherTimelineView.tsx` | `formatCents` importé | R8 |
| `packages/frontend/src/components/WeatherSeriesLegend.tsx` | `formatCents` importé | R8 |
| `packages/frontend/src/lib/ui-persistence.ts` | `WeatherAlgoDataTableId` dérivé de l'array `as const` | R2 |
| `packages/frontend/src/api.ts` | `WeatherAlgoDataTableId` importé de `ui-persistence` ; `WeatherAlgoClobPriceHistoryRow` typé | R2 |
| `packages/frontend/vite.config.ts` | Ajout de `@polywatch/core/backtest/exit-reasons` à `optimizeDeps.include` | R3 |

---

## 3. Ordre d'implémentation

### Phase 1 — Core (R1, R5, R3)
1. R1 : extraire `buildTimelineCities` dans `weather-algo-data.service.ts`.
2. R5 : nettoyer le debug Paris, rendre `maxPages` configurable, extraire `compareCityGroups`.
3. R3 : créer `backtest-exit-reasons.ts`, re-exports, sous-chemin `./backtest/exit-reasons`.

### Phase 2 — Backend (R6)
4. Créer `query-params.ts` ; migrer les 3 routes.

### Phase 3 — Backtest (R10)
5. Split `evaluateExits` en 3 helpers.

### Phase 4 — Frontend (R2, R3, R7, R8, R9)
6. Créer `format.ts`, `fidelity-options.ts`, `Pagination.tsx`, `WeatherWatchedTable.tsx`.
7. Migrer les composants consommateurs.

### Phase 5 — Validation
8. Builds + tests + lints + grep.

---

## 4. Tests

| Composant | Vérification | R |
|-----------|--------------|---|
| Core build + tests | `weather-algo-data.service.test.ts` (18/18, couvre R1), `weather-market-discovery.test.ts` (19/19, couvre R5) | R1/R5 |
| Backtest build + tests | `weather-adapter.test.ts` (8/8, couvre R10) | R10 |
| Backend build | Routes compilent avec les helpers partagés | R6 |
| Frontend build | Compile avec les nouveaux composants/libs ; `WeatherAlgoDataTableId` dérivé | R2/R3/R7/R8/R9 |
| Grep final | `rg "EXIT_REASON_LABEL"` frontend → import depuis `@polywatch/core/backtest/exit-reasons` (pas le point d'entrée) | R3 |

---

## 5. Risques résiduels & impacts docs

| Risque / impact | Mitigation |
|-----------------|------------|
| **R3** : importer `EXIT_REASON_LABEL` depuis le point d'entrée `@polywatch/core` tire typeorm dans le bundle navigateur (`Uncaught SyntaxError: ... does not provide an export named 'Buffer'`). | Le frontend importe depuis le sous-chemin typeorm-free `@polywatch/core/backtest/exit-reasons` (ajouté à `package.json` exports + `optimizeDeps.include`). Le backend continue d'importer depuis le point d'entrée. |
| **R1** : le guard `!cityKey` centralisé pourrait changer le comportement clob si `city` était nullable. | `WeatherClobPriceHistory.city` est non-nullable (colonne `text` NOT NULL) → aucun changement. |
| **R8** : `formatNum` a un défaut `digits=3` alors que l'ancien `fmtNum` de BacktestTab avait `digits=2`. | Tous les appels dans `WeatherAlgoBacktestTab` passent un `digits` explicite ; `WeatherAlgoDataTab` utilise le défaut `3` identique à l'ancien. |
| **R9** : `FIDELITY_OPTIONS` passe de `value: number` (HistoryIngest) à `value: string`. | Les consommateurs utilisent `Number(...)`/`String(...)` ; `WeatherTimelineSideOption.value` est `string`. |
| **R10** : le tri-state de `tryResolvePosition` doit reproduire le flux original (`continue` sur résolution/skip). | Vérifié : `'resolved'`/`'skip'` → `continue` ; `'fallthrough'` → évaluation de décision. |

---

## 6. Checklist prod

- [x] `npm run build` (workspace complet) — passe sans erreur
- [x] Tests core / backtest — aucune régression (les échecs pré-existants hors périmètre restent)
- [x] ReadLints — aucun nouveau lint error sur les fichiers modifiés
- [x] `rg "EXIT_REASON_LABEL"` frontend → import depuis le sous-chemin typeorm-free
- [x] `git diff --stat` — périmètre limité aux fichiers listés §2

---

## 7. Critère de complétude

- [x] R1 : `buildTimelineCities` extrait ; les 2 timelines l'utilisent ; tests 18/18
- [x] R2 : `WeatherAlgoDataTableId` dérivé ; rows typées ; `Pagination` partagé
- [x] R3 : `EXIT_REASON_LABEL` typeorm-free ; frontend importe via sous-chemin ; `FALLBACK_STRATEGIES` ; `Pagination`
- [x] R5 : debug Paris supprimé ; `maxPages` configurable ; `compareCityGroups` extrait
- [x] R6 : `query-params.ts` partagé ; 3 routes migrées
- [x] R7 : `WeatherWatchedTable` partagé (slot `renderHorizon`)
- [x] R8 : `lib/format.ts` consolidé ; consommateurs migrés
- [x] R9 : `lib/fidelity-options.ts` source unique ; 3 copies migrées
- [x] R10 : `evaluateExits` split en 3 helpers ; tests 8/8
- [x] Builds + tests + lints passent ; aucun fichier hors périmètre modifié

---

## 8. Suivi d'implémentation (2026-08-13)

Le plan a été implémenté intégralement le 2026-08-13. Cette section documente les écarts par rapport au plan initial et la validation.

### Écarts et corrections pendant l'implémentation

- **R2** : l'audit annonçait « 3 sources de table IDs » — la re-vérification en a trouvé **2** (`api.ts` + `ui-persistence.ts`). Le plan a été ajusté à la réalité du code.
- **R3** : l'audit annonçait « 3 cadences poll » — la re-vérification en a trouvé **1** (constante `POLL_MS`). Le plan a été ajusté.
- **R3 (bug)** : le re-export de `EXIT_REASON_LABEL` via `entities/BacktestPosition.ts` (qui importe typeorm) tirait typeorm dans le bundle frontend → `Uncaught SyntaxError: ... does not provide an export named 'Buffer'`. Corrigé en ajoutant un re-export direct de `backtest-exit-reasons.js` dans `packages/core/src/index.ts` **et** un sous-chemin d'export `./backtest/exit-reasons` dans `package.json`, puis en faisant importer le frontend depuis ce sous-chemin.
- **R9** : `FIDELITY_OPTIONS` initialement `as const` → type `readonly` incompatible avec `WeatherTimelineSideOption[]` (mutable). `as const` retiré.
- **R10** : `currentForecastMean` retourne `number | null` (fallback snapshot) ; `tryExitByDecision` accepte `currentMean: number | null`.

### Validation post-implémentation

- **Builds** : core, backtest, backend, frontend — **OK** (`tsc --noEmit`).
- **Tests** :
  - core : `weather-algo-data.service` **18/18** (R1), `weather-market-discovery` **19/19** (R5). 5 échecs pré-existants hors périmètre (`market-metadata` ×2, `policy` trailing, `snapshot-decision-collector-parity`, `resume-reserved-entry`).
  - backtest : **30/30**, dont `weather-adapter` **8/8** (R10).
- **Lints** : 0 erreur sur les fichiers modifiés.
- **Grep final** : `EXIT_REASON_LABEL` importé par le frontend depuis `@polywatch/core/backtest/exit-reasons` (typeorm-free).
- **Périmètre** : 25 fichiers (4 nouveaux modules core/backend + 4 nouveaux composants/libs frontend + 17 modifiés). Conforme à la §2.

### Reste à faire en prod

- Redémarrer le serveur Vite (ou vider `node_modules/.vite`) pour que le pré-bundling prenne en compte le nouveau sous-chemin `@polywatch/core/backtest/exit-reasons`.
- Smoke test UI : onglet Backtest (raisons de sortie affichées), onglet Données (pagination, rows typées), timelines bucket/clob (fidélité), panneaux watched-cities.
