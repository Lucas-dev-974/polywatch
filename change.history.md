# Change History

## 2026-08-15 — Weather-algo highest-yes edge cases : backtest resolution fallback + single mode city+date selection

### Fixed
- Backtest adapter (`packages/backtest/src/adapters/weather/weather-adapter.ts`) : résolution `weather-highest-yes` applique une chaîne de fallback `tick.yesPrice` → `pos.markPrice` (mis à jour à chaque book_tick) → `pos.entryPrice` au lieu de laisser la position ouverte indéfiniment quand `tick.yesPrice` est null. `evaluateExits` ne skip plus la résolution pour cette stratégie quand `yesPrice` est absent.

### Changed
- Strategy runner selection (`packages/weather-algo/src/strategy/strategy-runner-selection.ts`) : mode `single` sélectionne maintenant par **paire (ville, date cible)** au lieu de **ville seule**. Le signal au `edge` maximal détermine la paire gagnante ; tous les lanes (stratégies) pour cette paire sont émis. Cela permet à `weather-highest-yes` (edge=0) d'agir comme fallback par date quand aucune stratégie forecast n'a de signal sur cette date, au lieu d'être masqué par un signal forecast sur une autre date de la même ville.
- Propagation automatique : `runner-sim.ts::selectRunnerSimSignals` appelle `applySelectionMode` → bénéficie du nouveau comportement sans modification.

### Tests Added
- `packages/backtest/src/adapters/weather/weather-adapter.test.ts` : 2 tests — fallback markPrice + fallback entryPrice pour résolution `highest-yes`.
- `packages/weather-algo/src/strategy/strategy-runner-selection.test.ts` : 2 nouveaux tests — `single picks best city+date pair` + `single returns all lanes for best city+date` ; test existant mis à jour.

### Notes
- Guard post-sélection `maxPositionsPerCityDate` dans `strategy-runner.ts` conservé comme defense-in-depth (positions DB vs cycle courant).
- Tests validés : `weather-algo` 81/81, `backtest` 33/33.
- Doc mise à jour : `docs/weather-algo.md` (unité de sélection, modes single/multi, backtest fallback note).

## 2026-08-12 — Fix C3/C4/C5 weather-algo : source de vérité unique pour table ids, metric, exit reasons

### Added
- Core: `weather/metric.ts` — module leaf exportant `WEATHER_METRICS` (const array `['highest_temp','lowest_temp']`), `WeatherMetric` (type dérivé), `isWeatherMetric` (type guard runtime) — source unique pour les métriques weather
- Core: `BACKTEST_EXIT_REASONS` (const array des 10 exit reasons) dans `entities/BacktestPosition.ts` — `BacktestExitReason` devient un type dérivé de l'array
- Core: `WEATHER_ALGO_DATA_TABLE_IDS` (const array des 7 tables) dans `services/weather-algo-data.service.ts` — `WeatherAlgoDataTableId` devient un type dérivé de l'array
- Core: exports `WEATHER_METRICS`, `isWeatherMetric`, `WeatherMetric`, `BACKTEST_EXIT_REASONS`, `WEATHER_ALGO_DATA_TABLE_IDS` depuis `@polywatch/core`
- Core: `weather/metric.test.ts` — tests unitaires pour `WEATHER_METRICS` (ordre stable) et `isWeatherMetric` (accepte `highest_temp`/`lowest_temp`, rejette `temp`/`precip`/`''`/`null`/`undefined`/`42`)
- Core: guard `isWeatherMetric` dans `WeatherForecastService.getCached` — retourne `null` si `row.metric` est une valeur legacy invalide (au lieu de corrompre le type)
- Core: guard `isWeatherMetric` dans `WeatherHistoryIngestService.runJob` — aborte le job (status `error`, `errorMessage: 'invalid_metric'`, `finishedAt`) si `job.metric` est invalide
- Weather-algo: guard `isWeatherMetric` dans `strategy-runner` (skip la rule) et `weather-exit-evaluator` (skip les exit checks) — remplace les casts `as 'highest_temp' | 'lowest_temp'` qui masquaient les valeurs invalides

### Changed
- Core: `weather-forecast.service.ts` (`getOrFetch`/`getCached`/`save`/`ForecastResult.metric`) resserré de `string` → `WeatherMetric` ; suppression du cast `metric as 'highest_temp'|'lowest_temp'` ligne 68
- Core: `weather-auto-track.service.ts:addRule` resserré de `string` → `WeatherMetric` ; suppression de `resolvedMetric`
- Core: `weather-history-ingest.service.ts` — cast `job.metric as 'highest_temp'|'lowest_temp'` remplacé par guard `isWeatherMetric` runtime
- Core: `question-parser.ts`, `weather-api-client.ts`, `weather-market-discovery.ts`, `weather-forecast-enricher.ts` — unions `'highest_temp' | 'lowest_temp'` (~10 sites) remplacées par `WeatherMetric`
- Weather-algo: `strategy.ts` (`WeatherSignal.metric`) — union remplacée par `WeatherMetric`
- Weather-algo: `strategy-runner.ts:562`, `weather-exit-evaluator.ts:128` — signatures resserrées sur `WeatherMetric`
- Backend: `weather-algo-data.ts` — suppression du `VALID_TABLE_IDS` local dupliqué, import de `WEATHER_ALGO_DATA_TABLE_IDS` depuis `@polywatch/core` (C3)
- Backend: `backtest.ts:parseExitReason` — suppression de la liste littérale hardcodée, utilisation de `BACKTEST_EXIT_REASONS` (C5)
- Backend: `weather-algo-forecasts.ts` — guard manuel remplacé par `isWeatherMetric` (C4)
- Backend: `weather-algo-history.ts` — `zod enum` remplacé par `z.custom<WeatherMetric>(isWeatherMetric)` (C4)
- Frontend: `api.ts` — DTOs `metric: string` resserrés sur `WeatherMetric` (7 sites, dont `WeatherMetric | null` pour `WeatherBucketTickDto`)
- Tests: `weather-algo-data.service.test.ts` — `metric: 'temp'` → `'highest_temp'` (6 occurrences) ; `weather-exit-evaluator.test.ts` — mock `isWeatherMetric` ajouté

### Fixed
- Core: `weather-history-ingest.service.ts:459` — le guard `isWeatherMetric` ajouté omettait `finishedAt` dans l'update d'erreur, laissant le job avec `finishedAt: null` (pouvait bloquer la conflict guard indéfiniment) — corrigé

### Notes
- Les colonnes entité `metric: string` (`WeatherForecastCache`, `WeatherMarketSnapshot`, `WeatherBucketTick`, `WeatherClobPriceHistory`, `WeatherAutoTrackRule`, `WeatherHistoryIngestJob`) restent **inchangées** (pas de migration) pour la compat legacy ; la validation se fait en couche applicative via `isWeatherMetric`
- Le test `weather-adapter.test.ts` (`metric: 'precip'` intentionnel) reste valide (no-op)
- Contrat API inchangé (`highest_temp`/`lowest_temp` restent les seules valeurs autorisées)
- Réf : `docs/plans/2026-08-12_PLAN-fix-c3-c4-c5-weather-algo.md`, `docs/audits/2026-08-11_audit-weather-algo-complet.md`

## 2026-08-10 — Historique CLOB weather complet (point de settlement) + corrections types frontend

### Added
- Core: `detectResolvedSide()` — détecte le gagnant d'un marché météo résolu (fast path `outcomePrices` gate `closed`/`acceptingOrders` ; slow path `fetchGammaMarket` gate `gamma.resolved`)
- Core: `appendSettlementPoint()` — ajoute un point final synthétique (1.00 gagnant / 0.00 perdant) horodaté **après** le dernier trade, pour que le bucket gagnant atteigne 1.00 dans l'historique CLOB
- Core: `RESOLUTION_MARGIN_SEC = 48h` — fenêtre de fetch étendue au-delà de `endDate` (les marchés météo ne se règlent qu'après publication du résultat officiel)
- Core: tri DESC + re-sort ASC dans `getClobPriceHistoryTimeline` / `getBucketTicksTimeline` — récupère les `maxTicks` points les plus récents pour ne jamais tronquer la queue de résolution
- Frontend: correction de ~50 erreurs de type préexistantes (champs `EnvSettings` complétés, imports `market.ts` corrigés, clés JSX/SVG invalides retirées, source `config_change` ajoutée, null-guards socket/champs nullable)

### Changed
- Core: `resolveMarketEndTs()` ajoute `RESOLUTION_MARGIN_SEC` à `endDate`
- Docs: `weather-algo.md`, `code/08-weather-algo.md`, `api.md`, `modele-donnees.md` — documentent le point de settlement synthétique, la marge 48h et le tri `maxTicks`

## 2026-07-24 — Température de prédiction dans les headers dropdown

### Added
- Core: `ForecastEnrichedCityGroup` + `ForecastStatus` + `resolveGroupTargetDate()` dans `weather-market-discovery.ts`
- Core: `enrichCityGroupsWithForecast()` — enrichit les groupes par ville avec les forecasts Open-Meteo (cache DB + fetch parallèle)
- Core: 4 tests unitaires pour `enrichCityGroupsWithForecast` (cache fresh, cache miss, unavailable, stale fallback)
- Core: export de `enrichCityGroupsWithForecast`, `ForecastEnrichedCityGroup`, `ForecastStatus` depuis `@polywatch/core`
- Backend: `createWeatherAlgoDiscoverRouter(ds)` — injection de `DataSource` + appel à l'enrichisseur
- Frontend: `CityMarketGroup` étendu avec `targetDate`, `forecastMean`, `forecastStdDev`, `forecastStatus`
- Frontend: `WeatherCityGroup` affiche la température de prédiction dans le header (format "31.5°C" ou "—")
- Frontend: CSS `.weather-city-group__forecast` (+ stale / unavailable)
- Docs: route discover mise à jour avec les champs forecast

### Changed
- Backend: `createWeatherAlgoDiscoverRouter()` → `createWeatherAlgoDiscoverRouter(ds)` — accepte `DataSource` pour l'enrichissement forecast
- Core: import de `resolveWeatherDate` ajouté dans `weather-market-discovery.ts`

## 2026-07-24 — Regroupement des marchés weather par ville (backend + frontend)

### Added
- Core: `CityMarketGroup` interface + `groupMarketsByCity()` dans `weather-market-discovery.ts`
- Core: `byCity: CityMarketGroup[]` dans `WeatherMarketDiscoveryResult` — retourné par `discoverWeatherMarkets()`
- Core: export de `groupMarketsByCity` et `CityMarketGroup` depuis `@polywatch/core`
- Core: 6 tests unitaires pour `groupMarketsByCity` (groupement, dédup, tri, filtre métrique, cas vide)
- Frontend: `WeatherCityGroup` — composant accordion réutilisable (header cliquable, badge de compte, body repliable)
- Frontend: `lib/weather-grouping.ts` — utilitaire `groupByCity()` pour grouper les selections par ville
- Frontend: CSS — styles pour `.weather-city-group`, `.weather-discover-card`, `.weather-selection-card`

### Changed
- Frontend: `useWeatherAlgoDashboard` — `discoverResults` → `discoverGroups`, stocke `CityMarketGroup[]` au lieu de `DiscoverMarket[]`
- Frontend: `WeatherAlgoDiscoverPanel` — itère sur `CityMarketGroup[]` (groupé par ville) au lieu d'une liste plate
- Frontend: `WeatherAlgoActiveMarketsPanel` — groupe les marchés suivis par `sel.city` via `groupByCity()`
- Frontend: `WeatherAlgoPage` — props `results` → `groups`
- Docs: `docs/api.md` — mise à jour de la route discover avec le champ `byCity`
- Docs: `docs/architecture.md` — mention du groupement par ville dans le processus weather-algo
- Docs: `docs/frontend.md` — mention des accordions `WeatherCityGroup` dans la page Weather Algo

## 2026-07-23 — Weather Algo Integration

### Added
- New `@polywatch/weather-algo` package: trading algorithmique météo
  - Découverte de marchés température sur Polymarket (tag `weather`)
  - Prévisions multi-modèles Open-Meteo (5 modèles, mean + std dev)
  - Distribution de probabilité N(mean, stdDev) sur températures discrètes
  - Edge calculation avec seuil dynamique (uncertainty + time-to-resolution)
  - Selection modes: single, multi, spread
  - Re-entry throttle par eventSlug
  - Close on forecast change (drift > threshold)
  - Auto-close X heures avant résolution

- Core: nouvelles entités (`WeatherMarketSelection`, `WeatherAutoTrackRule`, `WeatherForecastCache`, `WeatherPositionForecast`)
- Core: `MarketType.WEATHER_TEMPERATURE` + `WEATHER_OTHER`
- Core: `OrderReason.WEATHER_OPEN` + `WEATHER_FORECAST_CHANGE`
- Core: `WORKER_QUEUES.WEATHER_ORDER_SIGNALS`
- Core: RiskConfig — 10 champs `weatherAlgo*`
- Core: migration `CreateWeatherAlgo1700000000070`
- Core: services `WeatherMarketSelectionService`, `WeatherAutoTrackService`, `WeatherForecastService`
- Core: `parseWeatherQuestion` (°C + °F, exact/or below/or above/between) + export subpath `@polywatch/core/weather/question-parser`
- Core: `discoverWeatherMarkets`, `fetchWeatherForecast`, `buildTempProbabilityDistribution`, `calculateEdge`, `resolveDynamicMinEdge`
- Core: `computeMarketImpliedProbabilities` étendu pour supporter `between` (targetLow/targetHigh)
- Core: `MarketClassifier` détecte les questions température (`isWeatherTemperatureQuestion`)

- Backend: 4 routes Express (`weather-algo-markets`, `weather-algo-discover`, `weather-algo-forecasts`, `weather-algo-auto-track`)
- Backend: champs `weatherAlgo*` ajoutés au `riskConfigUpdateSchema` (zod `.partial().strict()`)

- Worker: consumer file `weather-order-signals` + `WEATHER_OPEN` dans `ENTRY_BUY_REASONS`
- Worker: book readiness check étendu pour `WEATHER_OPEN`

- Frontend: page `WeatherAlgo` avec onglets (Marchés, Positions, Auto-track, Paramètres)
- Frontend: 8 sous-composants (`WeatherAlgoHeader`, `WeatherAlgoDiscoverPanel`, `WeatherAlgoActiveMarketsPanel`, `WeatherAlgoForecastPanel`, `WeatherAlgoPositionsPanel`, `WeatherAlgoExecutionsPanel`, `WeatherAlgoAutoTrackTab`, `WeatherAlgoSettingsTab`)
- Frontend: hooks `useWeatherAlgoDashboard`, `useWeatherAlgoPositions`
- Frontend: `@polywatch/core/weather/question-parser` ajouté au `optimizeDeps.include` de Vite (évite de tirer typeorm dans le bundle navigateur)
- Frontend: `api.ts` — exclusion de cache pour `/weather-algo-discover`

- Docs: routes weather-algo dans `docs/api.md`
- Docs: package + processus weather-algo dans `docs/architecture.md` (section 2 + files Redis section 3)
- Docs: champs `weatherAlgo*` + variables d'env dans `docs/configuration.md`
- Docs: entités weather dans `docs/modele-donnees.md`
- Docs: page Weather Algo dans `docs/frontend.md`
- Docs: `change.history.md` créé à la racine

### Fixed
- Frontend: import `parseWeatherQuestion` depuis le barrel `@polywatch/core` causait un `SyntaxError: Buffer` (typeorm tiré dans le navigateur) — corrigé via export subpath `@polywatch/core/weather/question-parser`
- Frontend: double préfixe `/api` dans les appels API de `WeatherAlgoPage.tsx` (`api('/api/weather-algo-markets')` → `api('/weather-algo-markets')`)