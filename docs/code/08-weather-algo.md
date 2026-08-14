# Package `@polywatch/weather-algo`

Couche de trading algorithmique sur marchés **température** Polymarket. Sélection
**city-first** (règles auto-track par ville) → découverte Gamma → forecast
Open-Meteo → edge YES → pipeline d'entrée (`weather-order-signals`) et sorties
dédiées (`close-signals`).

> État : **multi-stratégies** (`weather-forecast` + `weather-forecast-aligned` +
> `weather-highest-yes`).
> Catalogue + filtres JSON dans `WeatherConfig.weatherAlgoStrategies`. Config runtime =
> entité **`WeatherConfig`** (`weather_config`), **pas** `RiskConfig` (purgé).
> Doc produit synthétique : [`../weather-algo.md`](../weather-algo.md).

## Arborescence

| Fichier | Rôle |
|---|---|
| `index.ts` | Bootstrap, Redis ×3, queues, timers, shutdown |
| `config.ts` | Env monorepo (`WEATHER_ALGO_POLL_MS`, CLOB/Gamma/WS, cache forecast) |
| `constants.ts` | Fallbacks package (edge, TTL runtime-status, reentry, dedupe close) |
| `watchlist-seed.ts` | Watchlist sentinelle `traderAddress = 'weather-algo'` |
| `runtime-status.ts` | Publisher Redis `weather-algo:runtime-status` |
| `metrics-publisher.ts` | Flush parse rate + alertes backend |
| `real-cash.ts` | Wrapper cash réel (namespace log weather) |
| `strategy/strategy.ts` | Contrats `WeatherSignal` / `WeatherStrategy` |
| `strategy/registry.ts` | Registre ; `getOrdered(enabledIds)` selon catalogue core |
| `strategy/weather-forecast.strategy.ts` | Best-edge BUY YES (`evaluateGroup` + `pickBestEdgeBucket`) |
| `strategy/weather-forecast-aligned.strategy.ts` | Bucket aligné forecast (`selectForecastAlignedBucket`) |
| `strategy/weather-highest-yes.strategy.ts` | Bucket au prix YES max (consensus marché, sans forecast) |
| `strategy/evaluate-bucket-gate.ts` | Gates edge/probabilité partagés |
| `strategy/bucket-selection.ts` | `pickBestEdgeBucket`, `bucketCentre` |
| `strategy/strategy-runner-selection.ts` | `dedupSignalsByCity`, `applySelectionMode` |
| `strategy/strategy-runner.ts` | Boucle poll : exits puis entrées city-follow ; filtre `isMarketActiveForWeather` (core, partagé backtest) ; recorders data |
| `strategy/runner-bucket-helpers.ts` | Prix YES/NO buckets via `binaryPricesFromParsed` / `binaryPricesToUpDown` |
| `processors/weather-entry-pipeline.ts` | Sizing / MOS / reserve / enqueue |
| `processors/weather-exit-evaluator.ts` | Pre-close / drift / bucket-exit + hysteresis |

## Démarrage (`index.ts`)

1. `initializeDataSource` + `assertDatabaseExists`.
2. `seedWeatherAlgoWatchlistEntry` — watchlist sentinelle idempotente
   (`WEATHER_ALGO_TRADER_ADDRESS = 'weather-algo'`).
3. Services core : `WeatherConfigService`, `GlobalConfigService`,
   `WeatherForecastService`, `WeatherPositionForecastService`,
   `WeatherAutoTrackService`, `MarketService`, `ReservationService`,
   `SimulationService`.
4. **3 connexions Redis** (cmd, pub heartbeat, sub `config-changed`).
5. `WeatherStrategyRegistry` + enregistrement des stratégies catalogue au boot.
6. `PolymarketConnectionManager` (WS + CLOB) — échec WS → continue en REST.
7. Files Redis : `WORKER_QUEUES.WEATHER_ORDER_SIGNALS` (`weather-order-signals`)
   + `WORKER_QUEUES.CLOSE_SIGNALS` (`close-signals`).
8. `waitForBackendReady` (timeout 60 s) — **continue** si timeout (warn).
9. Charge `WeatherConfig` + `GlobalConfig` ; si `!weatherAlgoEnabled` →
   *standby* (entries off, exits on).
10. `WeatherExitEvaluator` + `onSignal` → `runWeatherEntryPipeline`.
11. `WeatherAlgoRuntimeStatusPublisher`, `WeatherAlgoMetricsPublisher`,
    `WeatherStrategyRunner.setRiskConfig(weatherConfig)` (naming hérité ;
    type = `WeatherConfig`).
12. `strategyRunner.start()` + `metricsPublisher.start()`.
13. Heartbeat 30 s → pub + clé `weather-algo:heartbeat` (TTL 60 s).
14. Sub `config-changed` (ignore `kind === 'copy' | 'crypto'`) → reload configs,
    `setRiskConfig` / `updateRiskConfig`, `requestEvaluationCycle`.

### Resilience patterns

- **Backend-ready timeout** : continue (warn) — pas de blocage boot.
- **WS fail** : log + continue REST.
- **Config reload** : `try/catch` — cycle suivant reprend.
- **Eval cycle** : `cycleRunning` + un `pendingRerun` trailing ; erreurs →
  `lastSkipReason = 'cycle_error'`.
- **Exit cycle isolé** : erreur exit n'empêche pas les entries du même tick.
- **Exit per-position** : `try/catch` individuel.
- **Snapshot forecast** (`saveIfAbsent`) : fail-open — entry enqueue quand même.
- **Cash réel indisponible** : skip mode `real` seulement.
- **`weatherAlgoEnabled = false`** : standby entries ; **sorties toujours
  évaluées**.

### Shutdown (`SIGTERM` / `SIGINT`)

1. `strategyRunner.stop()`
2. `metricsPublisher.stop()`
3. `clearInterval` heartbeat + data-purge
4. `connectionManager.getWsClient().disconnect()` (catch ignoré)
5. `redisCmd` / `Pub` / `Sub` `.quit()`
6. `ds.destroy()`
7. `process.exit(0)`

> Diff crypto-algo : pas de flag `shuttingDown` anti re-entrance ; pas de
> price-tick / surveillance / SelectionLoader.

## Processus & boucles

| Composant | Cadence | Rôle |
|---|---|---|
| `WeatherStrategyRunner` | `weatherAlgoPollMs` (défaut 30 min), **aligné grille UTC** | Exit puis entry city-follow. Polls sur multiples de `pollMs` depuis minuit UTC (`Math.ceil(now/pollMs)×pollMs`), indépendant de l'heure de boot, stable d'un redémarrage à l'autre. Au boot : passe d'exit immédiate (reprise positions ouvertes) + premier cycle complet au prochain créneau aligné. `config-changed` force un cycle immédiat. |
| Metrics publisher | 30 s | Parse rate questions + alertes |
| Heartbeat | 30 s | Pub + Redis TTL 60 s |
| WS Polymarket | boot | Prix exécutables ; **ne déclenche pas** l'eval (poll-driven) |

## Stratégies weather (catalogue `@polywatch/core`)

Interface (`strategy/strategy.ts`) : `evaluate` + `evaluateGroup?` optionnel.

| ID | Sélection bucket | Live défaut |
|---|---|---|
| `weather-forecast` | `pickBestEdgeBucket` (max edge YES) | oui |
| `weather-forecast-aligned` | `selectForecastAlignedBucket` | non |
| `weather-highest-yes` | bucket au max `yesPrice` (≥ `bag.minYesPrice`) | non |

- **BUY YES uniquement** (même si le type autorise NO).
- Edge = `forecastYesProb − marketYesPrice` (`core` `weather-edge.ts`) — pour
  `weather-highest-yes`, `edge=0` (pas de forecast) : le signal porte
  `confidence = min(1, yesPrice)` et `marketPrice = yesPrice`.
- Seuil dynamique : `resolveDynamicMinEdge(stdDev, hoursToResolution, minEdge)`
  (stratégies forecast uniquement).
- **Forecast optionnel** : `weather-highest-yes` s'évalue **sans** forecast. Si
  le forecast est indisponible dans le runner, les stratégies forecast
  s'abstiennent (`forecast_unavailable`) et seule `weather-highest-yes` est
  évaluée (ctx placeholder).
- **Tunables per-strategy** : `bag.minEdge`, `bag.maxForecastStd`,
  `bag.minForecastProbability` (stratégies forecast) + `bag.minYesPrice`
  (`weather-highest-yes`), lus via `getStrategyParams(weatherCfg,
  strategyId)`. Les colonnes `weatherAlgoMinEdge` / `maxForecastStd` /
  `minForecastProbability` ne sont plus lues au runtime — elles servent
  uniquement de source au backfill (migrations `0107`/`0108`).
- Knobs nullables (`maxForecastStd`, `minForecastProbability`,
  `slBidPoints`, `tpBidPoints`, `trailingBidPoints`,
  `trailingActivationBidPoints`) : `0` stocké → coercé à `null` au runtime
  (désactive le filtre / la jambe).
- Abstentions typiques : `no_question`, `unrecognized_question`,
  `zero_forecast_probability`, `forecast_probability_below_min`,
  `forecast_too_uncertain`, `no_market_prices`, `insufficient_edge`,
  `missing_token`, `no_aligned_bucket`, `yes_price_below_min`,
  `no_high_yes_bucket`.

Modes `single` / `multi` : appliqués dans le **runner**
(`applySelectionMode` / `dedupSignalsByCity`), pas dans la stratégie.
`spread` / inconnu → traité comme `single`.

**Safe reload** : `weatherAlgoStrategies` snapshot au début de chaque cycle ;
`activeStrategies` publié dans runtime-status.

Catalogue servi par `GET /api/weather-algo/strategy-catalog`. Params déclaratifs
(`weatherAlgoStrategyParams`) : **chaque stratégie porte sa config complète**
(entry gates, sizing, sorties, SL/TP/trailing, risk limits, kill-switch,
pre-close). Le bag typé `WeatherStrategyParamsBag` est défini dans
`strategy-catalog.ts` ; `getStrategyParams(cfg, strategyId)` résout le bag
(catalogue defaults + stored overrides + coercition `0 → null` pour les
nullables). `sanitizeWeatherStrategyParams` garde les clés de
`DEFAULT_WEATHER_STRATEGY_PARAMS` (donc `allowedMarketTags` survit même sans
champ UI). Les colonnes `weatherAlgo*` legacy ne sont plus modifiables via
l'API (`weatherConfigUpdateSchema` rejette les champs per-strategy via
`.strict()`).

## Pipeline entry (`weather-entry-pipeline.ts`)

File : **`weather-order-signals`** (pas `order-signals` / `algo-order-signals`).
Reason : `WEATHER_OPEN`. Interval hash logique : `'weather'`.

Gates (ordre) : enabled → marché tradable → pre-close hours (`bag.closeBeforeResolutionHours`) → liquidité ask →
modes sim/real (`weatherAlgoSimEnabled` / `weatherAlgoRealEnabled` +
`globalConfig.realTradingEnabled`) → cooldown post-exec → throttle re-entry
ville → **kill-switch gate** (`RiskService.checkKillSwitch('weather', mode,
signal.strategyId)` ; si `blockEntries` → skip `'Kill-switch actif
(block_entries)'`) → resume réservation → cash réel → sizing `fixed_usdc`
(`bag.entryUsdc`) + MOS / depth retry (`bag.entryDepthRetryMax` /
`bag.entryDepthRetryDelayMs`) → reserve (`strategyId` persisté sur
`CopiedPosition`) + enqueue → snapshot
forecast ASAP (1 position max / ville, `strategyId` persisté sur
`WeatherPositionForecast`).

## Sorties (`weather-exit-evaluator.ts`)

Paramètres lus depuis le bag de la stratégie d'origine :
`bag = getStrategyParams(risk, snapshot.strategyId ?? pos.strategyId ??
resolveEnabledWeatherStrategies(risk)[0] ?? 'weather-forecast')`.

Priorité :

1. `WEATHER_PRE_CLOSE` — `hoursToEnd ≤ bag.closeBeforeResolutionHours`
2. `WEATHER_FORECAST_CHANGE` — `|mean_now − mean_entry| >
   bag.forecastChangeThreshold` — **non évaluée pour `weather-highest-yes`**
3. `WEATHER_BUCKET_EXIT` — forecast hors palier **et** hysteresis
   (`bag.bucketHysteresisPolls`) **et** mode
   `bag.cityFollowSwitchMode = close_and_reenter` (`hold` = pas de close
   bucket ; `add_position` coercé → `close_and_reenter`) — **non évaluée pour
   `weather-highest-yes`**

> **`weather-highest-yes`** (sans forecast) : drift + bucket-exit désactivés.
> La position est tenue jusqu'à résolution — seuls pre-close
> (`WEATHER_PRE_CLOSE`) et SL/TP/trailing (worker) s'appliquent. L'exit
> evaluator skip le fetch forecast pour cette stratégie (évite une fermeture
> fantôme via `entryForecastMean=0`).

Redis :

- Hysteresis : `weather-bucket-hysteresis:{copiedPositionId}`
- Re-entry throttle (après bucket/drift) :
  `weather-reentry:{cityNormalized}:{mode}` TTL `bag.reentryThrottleMs`
- Dedupe close : `weather-close:{posId}:{reason}` (TTL 120 s)

File close : `close-signals` (partagée worker). Bid ≤ 0 → exit **différé**.
Forecast indisponible → skip drift/bucket (pas de close forcée).

**SL/TP/trailing weather** (gérés par le worker `position-exit-evaluator.ts`,
pas dans ce package) : `bag.slBidPoints` / `bag.tpBidPoints` /
`bag.trailingBidPoints` / `bag.trailingActivationBidPoints` /
`bag.slConfirmationTicks` / `bag.slCloseMaxRetries` — tous résolus via
`getWeatherSl*` avec `pos.strategyId`. `bag.slEnabled` /
`bag.tpEnabled` / `bag.trailingEnabled` par stratégie.

## Miroir crypto-algo (C8)

| Pattern partagé | Spécifique weather |
|---|---|
| Watchlist sentinelle + seed | Adresse `'weather-algo'` |
| Redis ×3, heartbeat, runtime-status | TTL status 300 s ; pas de `wsConnected` |
| Registry + stratégies catalogue | `weather-forecast` + `weather-forecast-aligned` + `weather-highest-yes` |
| Entry pipeline sizing/MOS/reserve | File `weather-order-signals`, reason `WEATHER_OPEN` |
| `config-changed` reload | Ignore kinds copy/crypto ; `WeatherConfig` |
| — | Exit evaluator **in-package** (crypto délègue SL/TP au worker) |
| — | Forecast + city-follow + hysteresis + reentry ville |
| — | Metrics parse questions |
| — | Poll-driven (pas price-feed / mid-history / curve gate) |

**Décision audit** : ne **pas** abstraire en `AlgoStrategyRunner` partagé —
documenter le miroir et converger par copie consciente.

## Env

| Var | Défaut |
|---|---|
| `WEATHER_ALGO_POLL_MS` | `1800000` (30 min) |
| `WEATHER_FORECAST_CACHE_TTL_MS` | `3600000` |
| `BACKEND_URL` | `http://localhost:3000` |
| `SERVICE_TOKEN` | (dev default) |
| `POLYMARKET_GAMMA_API` / `CLOB_API` / `WS_URL` | endpoints Polymarket publics |

Knobs runtime : **per-strategy** via `weatherAlgoStrategyParams` (bag
`WeatherStrategyParamsBag` dans `strategy-catalog.ts`, résolu par
`getStrategyParams`). Les colonnes `weatherAlgo*` legacy ne servent qu'au
backfill. Globaux structurels restants : `weatherAlgoEnabled` /
`weatherAlgoSimEnabled` / `weatherAlgoRealEnabled` /
`weatherAlgoSelectionMode` / `weatherAlgoMaxSignalsPerEvent` /
`weatherAlgoPollMs` / `weatherAlgoStrategies` / recording toggles /
retentionDays / `simInitialCapitalWeather`. Voir
[`../configuration.md`](../configuration.md).

## Persistance données marché (Phases 0–4)

Recorders core (injectés dans le runner depuis `index.ts`) :

- `WeatherForecastHistoryRecorder` — append-only si fetch réel (`!cache hit`, `!stale`)
- `WeatherMarketSnapshotRecorder` — snapshot + bulk `weather_bucket_ticks` (transaction)
- `WeatherEvaluationRecorder` — batch `weather_evaluation_log`

Purge horaire dans `index.ts` (rétention `WeatherConfig`, **même si recording OFF**).

Lecture / purge manuelle : `WeatherAlgoDataService` + routes
`/api/weather-algo-data/*` (backend). UI : onglet **Données**
(`WeatherAlgoDataTab`).

### Ingestion historique CLOB (Villes → Données télécharger)

`WeatherHistoryIngestService` (core) + routes `/api/weather-algo-history/*`
(backend). UI : onglet **Villes** → section **Données télécharger**
(`WeatherAlgoHistoryIngestSection`).

- Découverte des buckets ville/période via Gamma (`tag_slug=weather`,
  `closed`/`open`, `end_date_min/max`).
- Fetch CLOB `/prices-history` (`startTs`/`endTs` + `fidelity`) pour YES et NO,
  throttlé ; upsert idempotent dans `weather_clob_price_history` (index unique
  `condition_id, side, recorded_at, fidelity_minutes, metric` — plusieurs intervalles
  possibles par ville/date). Suppression ciblée par intervalle via
  `deleteCityInterval(city, fidelityMinutes)`.
- Jobs suivis dans `weather_history_ingest_jobs` (statut, progression,
  `points_upserted`, `markets_empty`).
- `startDate` dérivé du champ Gamma `startDate` (l'API ne renvoie plus
  `eventStartTime`) ; en dernier recours, fenêtre de 7 jours avant `endTs`
  (le CLOB rejette une requête sans `startTs` → HTTP 400).
- **Point de settlement synthétique** : `/prices-history` ne renvoie jamais le
  payoff post-résolution (1.00/0.00). Pour un marché résolu, `detectResolvedSide`
  (fast path `outcomePrices` gate `closed`/`acceptingOrders`, slow path
  `fetchGammaMarket` gate `gamma.resolved`) détermine le gagnant et
  `appendSettlementPoint` ajoute un point final (1.00 gagnant / 0.00 perdant)
  horodaté **après** le dernier trade. Fenêtre de fetch étendue de `48 h`
  au-delà de `endDate` (`RESOLUTION_MARGIN_SEC`).

Détail : [`../api.md`](../api.md) § Weather Algo history ; [`../modele-donnees.md`](../modele-donnees.md).

Détail : [`../weather-algo-audits-plans/2026-08-08_IMPL-weather-market-data-persistence.md`](../weather-algo-audits-plans/2026-08-08_IMPL-weather-market-data-persistence.md).

## Raccordements

- **Worker** : consomme `weather-order-signals` + `close-signals`.
- **Backend** : routes weather-algo (capital, executions, settings) +
  **weather-algo-data** — [`../api.md`](../api.md) ; métriques internes parse questions.
- **Core** : `discoverWeatherMarkets`, `WeatherForecastService`, edge helpers,
  redis throttles / hysteresis, `resolveWeatherEntryExitParams`, recorders data.
- **Frontend** : page Weather Algo (Marchés / Positions / Villes / **Données** /
  Paramètres).

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
