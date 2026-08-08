# Package `@polywatch/weather-algo`

Couche de trading algorithmique sur marchés **température** Polymarket. Sélection
**city-first** (règles auto-track par ville) → découverte Gamma → forecast
Open-Meteo → edge YES → pipeline d'entrée (`weather-order-signals`) et sorties
dédiées (`close-signals`).

> État : MVP — **une seule stratégie** (`weather-forecast`). Config runtime =
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
| `auto-track-janitor.ts` | Wrapper `WeatherAutoTrackService.syncMarketSelectionsForAutoTrack` |
| `metrics-publisher.ts` | Flush parse rate + alertes backend |
| `real-cash.ts` | Wrapper cash réel (namespace log weather) |
| `strategy/strategy.ts` | Contrats `WeatherSignal` / `WeatherStrategy` |
| `strategy/registry.ts` | Registre simple (pas de filtre JSON strategies) |
| `strategy/weather-forecast.strategy.ts` | Stratégie edge BUY YES |
| `strategy/strategy-runner.ts` | Boucle poll : exits puis entrées city-follow ; enregistrement snapshot / forecast history / eval log |
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
5. `WeatherStrategyRegistry` + `WeatherForecastStrategy`.
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
13. Timer auto-track (`config.pollMs`) + tick immédiat.
14. Heartbeat 30 s → pub + clé `weather-algo:heartbeat` (TTL 60 s).
15. Sub `config-changed` (ignore `kind === 'copy' | 'crypto'`) → reload configs,
    `setRiskConfig` / `updateRiskConfig`, `requestEvaluationCycle`.

### Resilience patterns

- **Backend-ready timeout** : continue (warn) — pas de blocage boot.
- **WS fail** : log + continue REST.
- **Auto-track tick** / **config reload** : `try/catch` — cycle suivant reprend.
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
3. `clearInterval` heartbeat + auto-track
4. `connectionManager.getWsClient().disconnect()` (catch ignoré)
5. `redisCmd` / `Pub` / `Sub` `.quit()`
6. `ds.destroy()`
7. `process.exit(0)`

> Diff crypto-algo : pas de flag `shuttingDown` anti re-entrance ; pas de
> price-tick / surveillance / SelectionLoader.

## Processus & boucles

| Composant | Cadence | Rôle |
|---|---|---|
| `WeatherStrategyRunner` | `WEATHER_ALGO_POLL_MS` puis `weatherAlgoPollMs` | Exit puis entry city-follow |
| Auto-track janitor | `config.pollMs` | Sync sélections ; pub `config-changed` si added |
| Metrics publisher | 30 s | Parse rate questions + alertes |
| Heartbeat | 30 s | Pub + Redis TTL 60 s |
| WS Polymarket | boot | Prix exécutables ; **ne déclenche pas** l'eval (poll-driven) |

## Stratégie `weather-forecast`

Interface (`strategy/strategy.ts`) : `evaluate(market, ctx) → WeatherEvaluationResult`.

- **BUY YES uniquement** (même si le type autorise NO).
- Edge = `forecastYesProb − marketYesPrice` (`core` `weather-edge.ts`).
- Seuil dynamique : `resolveDynamicMinEdge(stdDev, hoursToResolution, minEdge)`.
- Tunables `WeatherConfig` : `weatherAlgoMinEdge`, `weatherAlgoMaxForecastStd`,
  `weatherAlgoMinForecastProbability`.
- Abstentions typiques : `no_question`, `unrecognized_question`,
  `zero_forecast_probability`, `forecast_probability_below_min`,
  `forecast_too_uncertain`, `no_market_prices`, `insufficient_edge`,
  `missing_token`.

Modes `single` / `multi` : appliqués dans le **runner**
(`applySelectionMode` / `dedupSignalsByCity` / `pickBestEdgeBucket`), pas dans
la stratégie. `spread` / inconnu → traité comme `single`.

## Pipeline entry (`weather-entry-pipeline.ts`)

File : **`weather-order-signals`** (pas `order-signals` / `algo-order-signals`).
Reason : `WEATHER_OPEN`. Interval hash logique : `'weather'`.

Gates (ordre) : enabled → marché tradable → pre-close hours → liquidité ask →
modes sim/real (`weatherAlgoSimEnabled` / `weatherAlgoRealEnabled` +
`globalConfig.realTradingEnabled`) → cooldown post-exec → throttle re-entry
ville → resume réservation → cash réel → sizing `fixed_usdc`
(`weatherAlgoEntryUsdc`) + MOS / depth retry → reserve + enqueue → snapshot
forecast ASAP (1 position max / ville).

## Sorties (`weather-exit-evaluator.ts`)

Priorité :

1. `WEATHER_PRE_CLOSE` — `hoursToEnd ≤ weatherAlgoCloseBeforeResolutionHours`
2. `WEATHER_FORECAST_CHANGE` — `|mean_now − mean_entry| >
   weatherAlgoForecastChangeThreshold`
3. `WEATHER_BUCKET_EXIT` — forecast hors palier **et** hysteresis
   (`weatherAlgoBucketHysteresisPolls`) **et** mode
   `weatherAlgoCityFollowSwitchMode = close_and_reenter` (`hold` = pas de close
   bucket ; `add_position` coercé → `close_and_reenter`)

Redis :

- Hysteresis : `weather-bucket-hysteresis:{copiedPositionId}`
- Re-entry throttle (après bucket/drift) :
  `weather-reentry:{cityNormalized}:{mode}` TTL `weatherAlgoReentryThrottleMs`
- Dedupe close : `weather-close:{posId}:{reason}` (TTL 120 s)

File close : `close-signals` (partagée worker). Bid ≤ 0 → exit **différé**.
Forecast indisponible → skip drift/bucket (pas de close forcée).

## Miroir crypto-algo (C8)

| Pattern partagé | Spécifique weather |
|---|---|
| Watchlist sentinelle + seed | Adresse `'weather-algo'` |
| Redis ×3, heartbeat, runtime-status | TTL status 300 s ; pas de `wsConnected` |
| Registry + 1 stratégie MVP | `weather-forecast` (pas momentum) |
| Entry pipeline sizing/MOS/reserve | File `weather-order-signals`, reason `WEATHER_OPEN` |
| Auto-track janitor | Villes / `WeatherAutoTrackService` |
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

Knobs runtime : colonnes `weatherAlgo*` de `WeatherConfig` +
`GlobalConfig.realTradingEnabled`. Voir [`../configuration.md`](../configuration.md).

## Persistance données marché (Phases 0–4)

Recorders core (injectés dans le runner depuis `index.ts`) :

- `WeatherForecastHistoryRecorder` — append-only si fetch réel (`!cache hit`, `!stale`)
- `WeatherMarketSnapshotRecorder` — snapshot + bulk `weather_bucket_ticks` (transaction)
- `WeatherEvaluationRecorder` — batch `weather_evaluation_log`

Purge horaire dans `index.ts` (rétention `WeatherConfig`, **même si recording OFF**).

Lecture / purge manuelle : `WeatherAlgoDataService` + routes
`/api/weather-algo-data/*` (backend). UI : onglet **Données**
(`WeatherAlgoDataTab`).

Détail : [`../plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md`](../plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md).

## Raccordements

- **Worker** : consomme `weather-order-signals` + `close-signals`.
- **Backend** : routes weather-algo (capital, executions, settings) +
  **weather-algo-data** — [`../api.md`](../api.md) ; métriques internes parse questions.
- **Core** : `discoverWeatherMarkets`, `WeatherForecastService`, edge helpers,
  redis throttles / hysteresis, `resolveWeatherEntryExitParams`, recorders data.
- **Frontend** : page Weather Algo (Marchés / Positions / Villes / **Données** /
  Paramètres).

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
