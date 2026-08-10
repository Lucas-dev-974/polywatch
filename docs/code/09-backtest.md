# Package `@polywatch/backtest` — moteur de backtest événementiel (weather)

> **Vue d'ensemble produit** : [`../backtest.md`](../backtest.md).  
> **Plan d'origine** : [`../plans/2026-08-05_PLAN-backtest-engine-universel.md`](../plans/2026-08-05_PLAN-backtest-engine-universel.md).  
> **Patch fidélité 0.2.0** : [`../plans/applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](../plans/applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md).  
> **Périmètre v1** : domaine **weather uniquement** (crypto/copy hors scope).

## 1. Topologie du package

```
packages/backtest/src/
├── index.ts                       runBacktest + parseBacktestParams + BACKTEST_ENGINE_VERSION
├── params.ts                      schéma Zod backtestRunParamsSchema (+ configOverrides)
├── engine-version.ts              semver moteur (`0.2.0`)
├── adapters/
│   ├── backtest-domain-adapter.ts interface BacktestDomainAdapter
│   └── weather/
│       ├── data-loader.ts         chargement SQL (keyset) ; replay filtre strategyId/decision
│       ├── weather-adapter.ts     orchestration entrées/sorties (+ kill-switch, lifecycle)
│       ├── context-builder.ts     MarketListItemDto + ForecastRevisionStore
│       ├── question-builder.ts    synthèse question (entiers °C) pour parseWeatherQuestion
│       ├── resolution.ts          résolution par proxy forecast
│       ├── clocked-weather-strategy.ts  factory createWeatherStrategy + clock
│       ├── runner-sim.ts                mode runner-sim (proche live)
│       └── weather-adapter.test.ts
└── engine/
    ├── virtual-clock.ts
    ├── events.ts                  book_tick | forecast | signal | timer (timer non produit)
    ├── merge-event-streams.ts     merge k-way async (chemin prod)
    ├── merge-event-streams.test.ts
    ├── ledger.ts
    ├── fill-engine.ts
    ├── exit-manager.ts            (+ exit-manager.test.ts)
    ├── stats.ts                   computeStats (profitFactor null = ∞)
    ├── stats.test.ts
    └── runner.ts
```

## 2. Primitives du moteur

### `VirtualClock` (`engine/virtual-clock.ts`)
`now(): Date`, `advanceTo(t)`. Garde anti-retour : toute régression temporelle lève
`virtual_clock_regression` (signale des données mal triées ou un merge défectueux).

### `mergeEventStreams` (`engine/merge-event-streams.ts`)
Fusion k-way de `AsyncIterable<BacktestEvent>[]` par `event.at`. Heap borné (≤ nombre
de streams, typiquement 2–3). **Chaque tête initiale doit être heapifiée** (`bubbleUp`
après insert) — sinon le stream 0 est toujours émis en premier.

Tie-break à timestamp égal : `streamId` puis `seq` (ordre d'insertion).

### `Ledger` (`engine/ledger.ts`)
Cash initial + positions ouvertes/fermées en mémoire. `equityAt(t)` = cash +
mark-to-market des positions ouvertes via **`markPrice` courant** (dernier tick du
bucket). `peakBid` sert uniquement au trailing stop. Positions ouvertes persistées
avec `exitPrice`/`pnl`/`exitAt` = `null`. `entryReason` + `meta` (seuils SL/TP résolus,
edge, bucket…) stockés sur chaque position.

### `FillEngine` (`engine/fill-engine.ts`)
Fill d'entrée/sortie simulé : prix YES du tick × (1 ± `slippageBps`) ; fees via
`computeTakerFee` (`@polywatch/core`). Pas de profondeur de book → PnL indicatif.

### `computeStats` (`engine/stats.ts`)
Fonction pure : PnL total, equity finale, win rate, profit factor (`null` = +∞,
JSON-safe), avg win/loss, expectancy, **max drawdown**, `byExitReason`, `byCity`,
`avgHoldingMs`.

### `BacktestRunner` (`engine/runner.ts`)
Boucle `for await (const event of spec.events()) { clock.advanceTo(event.at); adapter.handle(event); }`.
- Yields `setImmediate` toutes les 5000 événements.
- Progression : `%` basé sur `countWeatherEvents` pré-calculé ; flush wall-clock ~2 s.
- Equity samples ~1/min de temps rejoué (`EQUITY_SAMPLE_INTERVAL_MS = 60_000`).
- Cancel → flush equity + positions → `markCancelled` (stats + warnings conservés).
- Timeout → flush equity + positions → `markFailed('timeout')` (**sans** stats/warnings).

## 3. Adaptateur weather

### `data-loader.ts` — pagination keyset `(timestamp, id)`
Charge trois sources en streams async :

| Source | Table | Colonne `event.at` |
|--------|-------|-------------------|
| Forecasts | `weather_forecast_history` | `fetchedAt` |
| Ticks | `weather_bucket_ticks` (colonnes dénormalisées `city`/`target_date_iso`/`metric` ; join snapshot uniquement pour `forecastMean`) | `recordedAt` |
| Signals (mode replay) | `weather_evaluation_log` | `evaluatedAt` |

Pagination : chunks de 5000, `ORDER BY <timestamp> ASC, id ASC`, curseur
`(lastAt, lastId)` via `applyTimeIdCursor`. **Ne jamais paginer par `id` seul**.

En replay : filtre SQL `decision = 'signal'` et `strategyId = params.strategyId`
(défaut `weather-forecast`).

Les streams sont fusionnés par `mergeEventStreams` avant consommation par le runner.

### `context-builder.ts`
Reconstruit le `MarketListItemDto` à partir des snapshots/ticks pour la
ré-évaluation. `ForecastRevisionStore` : dernier forecast par ville/date/metric
(as-of par construction — events en ordre temporel).

### `question-builder.ts`
Synthétise une question Polymarket parseable par `parseWeatherQuestion`.
Arrondit les bornes/target non entiers (`Math.round`) car le parser n’accepte
que `-?\d+`. Retourne `null` si la métrique n'est pas `highest_temp`/`lowest_temp`
(`unsupported_metric_or_bucket`).

### `weather-adapter.ts`
- Mode `reevaluate` : à chaque **`book_tick`**, reconstruit le contexte, filtre via
  `isMarketActiveForWeather` (`closed` / `acceptingOrders` / `tokenIdYes` /
  `closeBeforeHours` sur horloge virtuelle), puis selon `backtestExecutionMode` :
  - `strategy` (défaut) : `ClockedWeatherStrategy.evaluate` par bucket ;
  - `runner-sim` : `runner-sim.ts` regroupe les ticks, `evaluateGroup`, dedup /
    selectionMode (un `strategyId` forcé depuis les params UI).
  Les events `forecast` mettent à jour le store (pas d'évaluation stratégie).
- Mode `replay` : entre sur les décisions `signal` de `weather_evaluation_log`.
- **Garde-fous** (les deux modes) : `maxExposure`, `maxDailyLoss` (+
  `force_close_all` → clôture `KILL_SWITCH`), cash insuffisant, one-thesis-per-city,
  throttle re-entry (bucket/drift seulement).
- À l’entrée : `resolveWeatherEntryExitParams` → `meta.slBidPoints` / `tp*` / `trailing*`.
- **Sorties** : évaluées pour **toutes** les positions ouvertes à chaque
  `book_tick`, via `lastTickByCondition` (+ `at` pour warning `exit_stale_tick`).
- Résolution sans `endDate` : fallback
  `new Date(\`${targetDateIso}T23:59:59Z\`) + 24h`
  (`resolution_no_endate_fallback`). Si forecast absent →
  `resolution_no_forecast` (position laissée ouverte).

### `index.ts` — `configOverrides`
`runBacktest` fusionne `params.configOverrides` (`z.record(z.unknown())`, shallow
merge) sur le snapshot `WeatherConfig` **avant** le run. La route backend stocke
néanmoins `configSnapshotJson` / fingerprint **avant** overrides (config live).
`BACKTEST_ENGINE_VERSION` est écrit dans `backtest_runs.engine_version` au launch.

## 4. Exits (`engine/exit-manager.ts`)

| Raison | Condition | Throttle re-entry |
|--------|-----------|-------------------|
| `WEATHER_PRE_CLOSE` | `hoursToEnd <= closeBeforeResolutionHours` (prioritaire) | Non |
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > threshold` | **Oui** |
| `WEATHER_BUCKET_EXIT` | hors palier + `close_and_reenter` après `hysteresisPolls` avancées espacées de `weatherAlgoPollMs` | **Oui** |
| `SL` / `TP` / `TRAILING` | seuils résolus à l’entrée (`meta.*BidPoints`) ; `peakBid` pour trailing | Non |
| `KILL_SWITCH` | géré dans l’adapter (daily loss + `force_close_all`) | Non |
| `RESOLUTION` | marché résolu (adapter, pas ExitManager) | Non |

## 5. Intégration backend

- Router : `packages/backend/src/routes/backtest.ts`, monté sous `/api/backtest` (JWT).
- `runBacktest` exécute in-process (yields), la UI **polle** `GET /runs/:id`.
- Timeout : `BACKTEST_TIMEOUT_MS` (défaut 30 min) → flush + `failed` sans stats.
- Cancel : réponse immédiate `{ status: 'cancelling' }` → flush → `cancelled` + stats.
- DELETE : **409** `run_still_active` si `running`/`queued` (annuler d’abord).
- Verrou singleton : `BacktestRunService.hasActiveRun` (running **ou** queued) →
  `409` `run_already_active` sur `POST /runs`.
- `recoverOrphanedBacktestRuns` au boot → orphelins `failed` (`backend_restart`).
- `cancelAllActiveBacktestRuns` au shutdown graceful.

## 6. Dépendances

`@polywatch/core` (entités, services, fees, `resolveWeatherEntryExitParams`,
`isMarketActiveForWeather`), `@polywatch/weather-algo`
(`WeatherForecastStrategy` via `public-api.ts`). Le live ne dépend jamais du backtest.

## 7. Tests

- `engine/stats.test.ts` — Ledger, `computeStats`, `computeMaxDrawdown`.
- `engine/exit-manager.test.ts` — défauts SL/TP, throttle restreint, hystérésis `pollMs`.
- `engine/merge-event-streams.test.ts` — ordre temporel, régression heap init.
- `adapters/weather/weather-adapter.test.ts` — replay, meta persisté, limite
  positions, one-thesis-per-city, résolution fallback, metric non supporté, hors plage.
- `packages/core/src/services/backtest-run.service.test.ts` — verrou singleton.

Lancement : `npm run test -w @polywatch/backtest` (**24** tests).
