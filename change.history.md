# Change History

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