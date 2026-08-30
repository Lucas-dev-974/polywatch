# Package `@polywatch/weather-algo`

Couche de trading algorithmique sur marchés **température** Polymarket. Sélection
**city-first** (règles auto-track par ville) → découverte Gamma → forecast
Open-Meteo → edge YES → pipeline d'entrée (`weather-order-signals`) et sorties
dédiées (`close-signals`).

> État : **une stratégie active par environnement** (sim / real), choisie parmi
> `weather-forecast` / `weather-forecast-aligned` / `weather-highest-yes`.
> Deux registres évaluent séparément sim et real (plan per-env 2026-08-27).
> Pas de cascade first-wins : si la stratégie active s’abstient, rien n’est émis.
> Un bag multi-id legacy est clampé à un id (`clampEnabledWeatherStrategies`,
> ordre catalogue). Les positions déjà ouvertes continuent de sortir sur leur
> `strategyId` d’origine.
> Catalogue + filtres JSON dans les 4 colonnes per-env
> (`simWeatherAlgoStrategies` / `realWeatherAlgoStrategies` +
> `simWeatherAlgoStrategyParams` / `realWeatherAlgoStrategyParams`). Config runtime =
> entité **`WeatherConfig`** (`weather_config`), **pas** `RiskConfig` (purgé).
> Doc produit synthétique : [`../reference/weather-algo.md`](../reference/weather-algo.md).

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
| `strategy/strategy.ts` | Contrats `WeatherSignal` (porte `mode`) / `WeatherStrategy` |
| `strategy/registry.ts` | Registre ; `getOrdered(enabledIds)` selon catalogue core ; **2 instances** (`registrySim`, `registryReal`) dans le runner |
| `strategy/weather-forecast.strategy.ts` | Best-edge BUY YES (`evaluateGroup` + `pickBestEdgeBucket`) |
| `strategy/weather-forecast-aligned.strategy.ts` | Bucket aligné forecast (`selectForecastAlignedBucket`) |
| `strategy/weather-highest-yes.strategy.ts` | Bucket au prix YES max (consensus marché, sans forecast) |
| `strategy/evaluate-bucket-gate.ts` | Gates edge/probabilité partagés |
| `strategy/bucket-selection.ts` | `pickBestEdgeBucket`, `bucketCentre` |
| `strategy/strategy-runner-selection.ts` | `dedupSignalsByCityDate`, `applySelectionMode` |
| `strategy/strategy-runner.ts` | Boucle poll : exits puis entrées city-follow ; discovery marché **1×** + évaluation stratégies **2× (sim + real)** ; filtre `isMarketActiveForWeather` (core, partagé backtest) ; recorders data |
| `strategy/runner-bucket-helpers.ts` | Prix YES/NO buckets via `binaryPricesFromParsed` / `binaryPricesToUpDown` |
| `processors/weather-entry-pipeline.ts` | Sizing / MOS / reserve / enqueue |
| `processors/weather-exit-evaluator.ts` | Drift / bucket-exit + hysteresis |

## Démarrage (`index.ts`)

1. `initializeDataSource` + `assertDatabaseExists`.
2. `seedWeatherAlgoWatchlistEntry` — watchlist sentinelle idempotente
   (`WEATHER_ALGO_TRADER_ADDRESS = 'weather-algo'`).
3. Services core : `WeatherConfigService`, `GlobalConfigService`,
   `WeatherForecastService`, `WeatherPositionForecastService`,
   `WeatherAutoTrackService`, `MarketService`, `ReservationService`,
   `SimulationService`.
4. **3 connexions Redis** (cmd, pub heartbeat, sub `config-changed`).
5. **2 `WeatherStrategyRegistry`** (`registrySim`, `registryReal`) +
   enregistrement des stratégies catalogue dans les deux au boot.
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
3. `clearInterval` heartbeat
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
| `weather-highest-yes` | bucket au max `yesPrice` (≥ `bag.minYesPrice`) — gates `bag.maxYesPrice` (plafond anti-fade, défaut `null`) + `bag.allowedComparisons` (filtre types de paliers) | non |

- **BUY YES uniquement** (même si le type autorise NO).
- Edge = `forecastYesProb − marketYesPrice` (`core` `weather-edge.ts`) — pour
  `weather-highest-yes`, `edge=0` (pas de forecast) : le signal porte
  `confidence = min(1, yesPrice)` et `marketPrice = yesPrice`.
- Seuil dynamique : `resolveDynamicMinEdge(stdDev, hoursToResolution, minEdge)`
  (stratégies forecast uniquement).
- **Forecast optionnel** : `weather-highest-yes` s'évalue **sans** forecast.
  Si la stratégie **active** est forecast et que le forecast est indisponible,
  le runner s'abstient (`forecast_unavailable`) — pas de repli automatique vers
  `weather-highest-yes`.
- **Tunables per-strategy** : `bag.minEdge`, `bag.maxForecastStd`,
  `bag.minForecastProbability` (stratégies forecast) + `bag.minYesPrice`
  (`weather-highest-yes`), lus via `getStrategyParamsForMode(weatherCfg,
  strategyId, mode)`. Les colonnes `weatherAlgoMinEdge` / `maxForecastStd` /
  `minForecastProbability` ne sont plus lues au runtime — elles servent
  uniquement de source au backfill (migrations `0107`/`0108`).
- Knobs nullables (`maxForecastStd`, `minForecastProbability`,
  `slPercent`, `tpPercent`, `trailingPercent`,
  `trailingActivationPercent`) : `0` stocké → coercé à `null` au runtime
  (désactive le filtre / la jambe).
- Abstentions typiques : `no_question`, `unrecognized_question`,
  `zero_forecast_probability`, `forecast_probability_below_min`,
  `forecast_too_uncertain`, `no_market_prices`, `insufficient_edge`,
  `missing_token`, `no_aligned_bucket`, `yes_price_below_min`,
  `no_high_yes_bucket`.

Modes `single` / `multi` : appliqués dans le **runner**
(`applySelectionMode` / `dedupSignalsByCityDate`) **à l'intérieur** de la
stratégie active (villes/dates), pas entre stratégies.
`spread` / inconnu → traité comme `single`.

**Safe reload** : les stratégies par environnement
(`resolveEnabledWeatherStrategiesForMode(risk, mode)`) sont snapshotées au début
de chaque cycle ; une modif de config en cours de cycle s'applique **au cycle
suivant** ; `activeStrategiesSim` / `activeStrategiesReal` publiés dans
runtime-status.

Catalogue servi par `GET /api/weather-algo/strategy-catalog`. Params déclaratifs
(`simWeatherAlgoStrategyParams` / `realWeatherAlgoStrategyParams`) : **chaque
stratégie porte sa config complète** (entry gates, sizing, sorties,
SL/TP/trailing, risk limits, kill-switch), **par environnement**.
Le bag typé `WeatherStrategyParamsBag` est défini dans
`strategy-catalog.ts` ; `getStrategyParamsForMode(cfg, strategyId, mode)`
résout le bag (catalogue defaults + stored overrides + coercition `0 → null`
pour les nullables). Fallback legacy **uniquement** si la colonne per-env est
`undefined` / `null` / `''` — `'[]'` / `'{}'` ne retombent pas.
`sanitizeWeatherStrategyParams` ne conserve que les clés de
`DEFAULT_WEATHER_STRATEGY_PARAMS` (`minTimeToClose` / `minBidToAskRatio` /
`allowedMarketTags` sont retirés du bag et de l'UI ; les colonnes DB
`weatherAlgo*` correspondantes restent non lues). Les colonnes legacy `weatherAlgoStrategies` /
`weatherAlgoStrategyParams` restent acceptées par `weatherConfigUpdateSchema`
(dépréciées, **retirées du patch** avant persist) ; les autres knobs
per-strategy hors schéma (ex. `weatherAlgoMinEdge`) → 400 via `.strict()`.

## Pipeline entry (`weather-entry-pipeline.ts`)

File : **`weather-order-signals`** (pas `order-signals` / `algo-order-signals`).
Reason : `WEATHER_OPEN`. Interval hash logique : `'weather'`.

Gates (ordre) : enabled → marché tradable → liquidité ask →
**signal scoped à un seul mode** (`signal.mode` — seuls `runMode` du mode du
signal sont exécutés, l'autre mode n'est jamais candidat pour ce signal) →
cooldown post-exec → throttle re-entry
ville+date → **kill-switch gate** (`RiskService.checkKillSwitch('weather', mode,
signal.strategyId)` ; si `blockEntries` → skip `'Kill-switch actif
(block_entries)'`) → resume réservation → cash réel → sizing (`bag.sizingMode` :
`fixed_pusd` via `bag.entryPusd` ou `fixed_shares` via `bag.fixedShareCount`) + MOS / depth retry (`bag.entryDepthRetryMax` /
`bag.entryDepthRetryDelayMs`) → reserve (`strategyId` + `mode` persistés sur
`CopiedPosition`) + enqueue → snapshot
forecast ASAP (`maxPositionsPerCityDate` par ville+date+stratégie+**mode**, `strategyId` persisté sur
`WeatherPositionForecast`).

**Exécution worker (sim + réel)** : le signal porte `orderType: 'FAK'` (comme le
copy-trading). Le `RealExecutor` n'envoie **jamais** de GTC resting — FOK si
`signal.orderType === 'FOK'`, sinon FAK (`createAndPostMarketOrder`).
`prepareFakMarketOrder` traite `WEATHER_OPEN` comme les autres BUY d'entrée
(`COPY_OPEN` / `ALGO_OPEN`) : book frais ≤ `ALGO_BOOK_FRESH_MS` (15 s), limite
BUY arrondie **au tick supérieur**, garde-fou slippage **tick-aware** (plancher
`MIN_SLIPPAGE_TICKS = 2` ticks, pour que 1 tick à 4 ¢ ne soit pas rejeté comme
25 % de slippage). En **real**, le pipeline bump la quantité pour que le
notionnel atteigne `MIN_ORDER_PUSD` (1 pUSD) — 5 parts × 0.14 $ = 0.70 $ est
sous le minimum CLOB live, d'où des FAK unmatched ; skip si le bump dépasse
cash ou `maxPositionSizePusd`. Le `RealExecutor` fait un `forceRefreshBook`
REST **avant** le prepare. Le fill **sim** (`Executor.simulateFill`) rafraîchit
aussi le book REST avant prepare, puis match FAK sur un second snapshot T1 ;
profondeur insuffisante → `order_not_matched` (pas de fill partiel fantôme).

**Pad d'entrée configurable** : les BUY `WEATHER_OPEN` paient `bag.entryTickPad`
ticks (défaut 1, clampé 0-3) **après** le guard slippage pour rendre l'ordre
marketable sur un carnet YES fin. Le plancher du guard slippage est relevé à
`max(MIN_SLIPPAGE_TICKS, entryTickPad)` pour que le pad lui-même ne soit jamais
compté comme un mouvement adverse. `entryTickPad = 0` désactive le pad.

**Gate de profondeur ask** : `bag.minAskDepthShares` (défaut 0 = désactivé)
relève la quantité cible du depth retry à `max(orderQty, minAskDepthShares)`
pour ne pas envoyer un FAK sans contrepartie sur un carnet trop fin.

**Diagnostic CLOB** : `parseFillResponse` distingue désormais un vrai kill FAK
(pas de contrepartie → `order_not_matched`, code exact) d'un rejet exchange
(statut `FAILED`/`REJECTED`, `success:false`, champ `error`/`errorMsg` non-kill →
`clob_rejected:<raison>`). `clob_rejected` est retryable pour les sorties
forcées (`isForcedExitRetryableError` prefix-aware).

## Sorties (`weather-exit-evaluator.ts`)

Paramètres lus depuis le bag de la stratégie d'origine **pour l'environnement
de la position** (`pos.mode`) :
`bag = getStrategyParamsForMode(risk, snapshot.strategyId ?? pos.strategyId ??
resolveEnabledWeatherStrategiesForMode(risk, pos.mode)[0] ?? 'weather-forecast',
pos.mode)`.

Priorité :

1. `WEATHER_FORECAST_CHANGE` — `|mean_now − mean_entry| >
   bag.forecastChangeThreshold` — **non évaluée pour `weather-highest-yes`**
2. `WEATHER_BUCKET_EXIT` — forecast hors palier **et** hysteresis
   (`bag.bucketHysteresisPolls`) **et** mode
   `bag.cityFollowSwitchMode = close_and_reenter` (`hold` = pas de close
   bucket ; `add_position` coercé → `close_and_reenter`) — **non évaluée pour
   `weather-highest-yes`**

> **`weather-highest-yes`** (sans forecast) : drift + bucket-exit désactivés.
> La position est tenue jusqu'à résolution — seuls SL/TP/trailing (worker)
> s'appliquent. L'exit evaluator skip le fetch forecast pour cette stratégie
> (évite une fermeture fantôme via `entryForecastMean=0`).

Redis :

- Hysteresis : `weather-bucket-hysteresis:{copiedPositionId}`
- Re-entry throttle (après bucket/drift) :
  `weather-reentry:{cityNormalized}:{dateIso}:{mode}` TTL `bag.reentryThrottleMs`
- `reentryThrottleAfterSlMs` (défaut 30 min) : throttle posé par le **worker**
  après une sortie SL, distinct du throttle bucket/drift. `0` = désactivé.
- Dedupe close : `weather-close:{posId}:{reason}` (TTL 120 s)

File close : `close-signals` (partagée worker). Bid ≤ 0 → exit **différé**.
Forecast indisponible → skip drift/bucket (pas de close forcée).

**SL/TP/trailing weather** (gérés par le worker `position-exit-evaluator.ts`,
pas dans ce package) : `bag.slPercent` / `bag.tpPercent` /
`bag.trailingPercent` / `bag.trailingActivationPercent` /
`bag.slConfirmationTicks` / `bag.slCloseMaxRetries` — tous résolus via
`resolveWeatherEntryExitParams` avec `pos.strategyId`. `bag.slEnabled` /
`bag.tpEnabled` / `bag.trailingEnabled` par stratégie. Les seuils sont en
**pourcentage de la mise investie** (cost basis + frais), pas en bid points.

## Miroir crypto-algo (C8)

| Pattern partagé | Spécifique weather |
|---|---|
| Watchlist sentinelle + seed | Adresse `'weather-algo'` |
| Redis ×3, heartbeat, runtime-status | TTL status 300 s ; pas de `wsConnected` |
| Registry + stratégies catalogue | `weather-forecast` + `weather-forecast-aligned` + `weather-highest-yes` |
| Entry pipeline sizing/MOS/reserve | File `weather-order-signals`, reason `WEATHER_OPEN`, `orderType: FAK` |
| `config-changed` reload | Ignore kinds copy/crypto ; `WeatherConfig` |
| — | Exit evaluator **in-package** (crypto délègue SL/TP au worker) |
| — | Forecast + city-follow + hysteresis + reentry ville+date |
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

Knobs runtime : **per-strategy et per-env** via
`simWeatherAlgoStrategyParams` / `realWeatherAlgoStrategyParams` (bag
`WeatherStrategyParamsBag` dans `strategy-catalog.ts`, résolu par
`getStrategyParamsForMode`). Les colonnes legacy `weatherAlgo*` ne servent qu'au
backfill / rétrocompat backtest. Globaux structurels restants : `weatherAlgoEnabled` /
`weatherAlgoSimEnabled` / `weatherAlgoRealEnabled` /
`weatherAlgoSelectionMode` / `weatherAlgoMaxSignalsPerEvent` /
`weatherAlgoPollMs` / `simWeatherAlgoStrategies` / `realWeatherAlgoStrategies` /
recording toggles /
retentionDays / `simInitialCapitalWeather`. Voir
[`../reference/configuration.md`](../reference/configuration.md).

## Persistance données marché (Phases 0–4)

Recorders core (injectés dans le runner depuis `index.ts`) :

- `WeatherForecastHistoryRecorder` — append-only si fetch réel (`!cache hit`, `!stale`)
- `WeatherMarketSnapshotRecorder` — snapshot + bulk `weather_bucket_ticks` (transaction)
- `WeatherEvaluationRecorder` — batch `weather_evaluation_log` (colonne `mode` `sim`/`real`)

Purge automatique **désactivée** dans `index.ts` (sur demande utilisateur). Cleanup manuel via UI/API.

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

Détail : [`../reference/api.md`](../reference/api.md) § Weather Algo history ; [`../reference/modele-donnees.md`](../reference/modele-donnees.md).

Détail : [`../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md`](../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md).

## Raccordements

- **Worker** : consomme `weather-order-signals` + `close-signals`.
- **Backend** : routes weather-algo (capital, executions, settings) +
  **weather-algo-data** — [`../reference/api.md`](../reference/api.md) ; métriques internes parse questions.
- **Core** : `discoverWeatherMarkets`, `WeatherForecastService`, edge helpers,
  redis throttles / hysteresis, `resolveWeatherEntryExitParams`, recorders data.
- **Frontend** : page Weather Algo (Marchés / Positions / Villes / **Données** /
  Paramètres).

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
