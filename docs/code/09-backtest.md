# Package `@polywatch/backtest` — moteur de backtest événementiel (weather)

> **Vue d'ensemble produit** : [`../backtest.md`](../backtest.md).  
> **Plan d'origine** : [`../plans/2026-08-05_PLAN-backtest-engine-universel.md`](../plans/2026-08-05_PLAN-backtest-engine-universel.md).  
> **Périmètre v1** : domaine **weather uniquement** (crypto/copy hors scope).

## 1. Topologie du package

```
packages/backtest/src/
├── index.ts                       runBacktest + parseBacktestParams (+ createWeatherAdapter unused by route)
├── params.ts                      schéma Zod backtestRunParamsSchema (+ configOverrides)
├── adapters/
│   ├── backtest-domain-adapter.ts interface BacktestDomainAdapter
│   └── weather/
│       ├── data-loader.ts         chargement SQL (pagination keyset timestamp+id)
│       ├── weather-adapter.ts     orchestration entrées/sorties
│       ├── context-builder.ts     MarketListItemDto + ForecastRevisionStore
│       ├── question-builder.ts    synthèse question pour parseWeatherQuestion
│       ├── resolution.ts          résolution par proxy forecast
│       ├── clocked-weather-forecast.strategy.ts  injecte clock.now() dans evaluate
│       └── weather-adapter.test.ts
└── engine/
    ├── virtual-clock.ts
    ├── events.ts                  book_tick | forecast | signal | timer (timer non produit)
    ├── event-bus.ts               min-heap — non référencé (ni prod, ni tests)
    ├── merge-event-streams.ts     merge k-way async (chemin prod)
    ├── merge-event-streams.test.ts
    ├── ledger.ts
    ├── fill-engine.ts
    ├── exit-manager.ts
    ├── stats.ts                   computeStats (fonction, pas de classe)
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

### `EventBus` (`engine/event-bus.ts`)
Min-heap synchrone **non importé** nulle part. Chemin prod = `mergeEventStreams` +
`for await` dans le runner.

### `Ledger` (`engine/ledger.ts`)
Cash initial + positions ouvertes/fermées en mémoire. `equityAt(t)` = cash +
mark-to-market des positions ouvertes via **`markPrice` courant** (dernier tick du
bucket). `peakBid` sert uniquement au trailing stop. Positions ouvertes persistées
avec `exitPrice`/`pnl`/`exitAt` = `null`. `entryReason` stocké sur chaque position.

### `FillEngine` (`engine/fill-engine.ts`)
Fill d'entrée/sortie simulé : prix YES du tick × (1 ± `slippageBps`) ; fees via
`computeTakerFee` (`@polywatch/core`). Pas de profondeur de book → PnL indicatif.

### `computeStats` (`engine/stats.ts`)
Fonction pure : PnL total, equity finale, win rate, profit factor, avg win/loss,
expectancy, **max drawdown** (calculé sur les points d'equity).

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
| Ticks | `weather_bucket_ticks` (+ join snapshot) | `recordedAt` |
| Signals (mode replay) | `weather_evaluation_log` | `evaluatedAt` |

Pagination : chunks de 5000, `ORDER BY <timestamp> ASC, id ASC`, curseur
`(lastAt, lastId)` via `applyTimeIdCursor`. **Ne jamais paginer par `id` seul**.

Les streams sont fusionnés par `mergeEventStreams` avant consommation par le runner.

### `context-builder.ts`
Reconstruit le `MarketListItemDto` à partir des snapshots/ticks pour la
ré-évaluation. `ForecastRevisionStore` : dernier forecast par ville/date/metric,
as-of `fetchedAt` (horloge virtuelle).

### `question-builder.ts`
Synthetise une question Polymarket parseable par `parseWeatherQuestion`.
Retourne `null` si la métrique n'est pas `highest_temp`/`lowest_temp`
(`unsupported_metric_or_bucket`).

### `weather-adapter.ts`
- Mode `reevaluate` : à chaque **`book_tick`**, reconstruit le contexte et appelle
  `ClockedWeatherForecastStrategy.evaluate` → décision d'entrée. Les events
  `forecast` mettent à jour le store (pas d'évaluation stratégie).
- Mode `replay` : entre sur les décisions `signal` de `weather_evaluation_log`.
- **Garde-fous** (les deux modes) : `maxExposure`, `maxDailyLoss`, cash insuffisant,
  one-thesis-per-city (`hasOpenCity`), throttle re-entry (`isReentryBlocked`).
- **Sorties** : évaluées pour **toutes** les positions ouvertes à chaque
  `book_tick`, via `lastTickByCondition`.
- Résolution sans `endDate` : fallback
  `new Date(\`${targetDateIso}T23:59:59Z\`) + 24h`
  (`resolution_no_endate_fallback`). Si forecast absent →
  `resolution_no_forecast` (position laissée ouverte).

### `index.ts` — `configOverrides`
`runBacktest` fusionne `params.configOverrides` (`z.record(z.unknown())`, shallow
merge) sur le snapshot `WeatherConfig` **avant** le run. La route backend stocke
néanmoins `configSnapshotJson` / fingerprint **avant** overrides (config live).
`createWeatherAdapter` est exporté mais non utilisé par la route (qui appelle
`runBacktest`).

## 4. Exits (`engine/exit-manager.ts`)

| Raison | Condition |
|--------|-----------|
| `WEATHER_PRE_CLOSE` | `hoursToEnd <= closeBeforeResolutionHours` (prioritaire) |
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > threshold` |
| `WEATHER_BUCKET_EXIT` | forecast hors palier + hysteresis en mémoire |
| `SL` / `TP` / `TRAILING` | offsets depuis le prix d'entrée (`peakBid` pour trailing) |
| `RESOLUTION` | marché résolu (géré dans l'adapter, pas ExitManager) |

Sur chaque close (hors résolution adapter) : `markClosed(city)` pour le throttle
re-entry (`weatherAlgoReentryThrottleMs`, défaut 30 min).

## 5. Intégration backend

- Router : `packages/backend/src/routes/backtest.ts`, monté sous `/api/backtest` (JWT).
- `runBacktest` exécute in-process (yields), la UI **polle** `GET /runs/:id`.
- Timeout : `BACKTEST_TIMEOUT_MS` (défaut 30 min) → flush + `failed` sans stats.
- Cancel : réponse immédiate `{ status: 'cancelling' }` → flush → `cancelled` + stats.
- Verrou singleton : `BacktestRunService.hasActiveRun` (running **ou** queued) →
  `409` sur `POST /runs`.
- `recoverOrphanedBacktestRuns` au boot → orphelins `failed` (`backend_restart`).
- `cancelAllActiveBacktestRuns` au shutdown graceful.

## 6. Dépendances

`@polywatch/core` (entités, services, fees), `@polywatch/weather-algo`
(`WeatherForecastStrategy` via `public-api.ts`). Le live ne dépend jamais du backtest.

## 7. Tests

- `engine/stats.test.ts` — Ledger, `computeStats`, `computeMaxDrawdown`.
- `engine/merge-event-streams.test.ts` — ordre temporel, régression heap init.
- `adapters/weather/weather-adapter.test.ts` — replay, meta persisté, limite
  positions, one-thesis-per-city, résolution fallback, metric non supporté, hors plage.
- `packages/core/src/services/backtest-run.service.test.ts` — verrou singleton.
