# Package `@polywatch/backtest` — moteur de backtest événementiel (weather)

> **Vue d'ensemble produit** : [`../backtest.md`](../backtest.md).  
> **Plan d'origine** : [`../plans/2026-08-05_PLAN-backtest-engine-universel.md`](../plans/2026-08-05_PLAN-backtest-engine-universel.md).  
> **Périmètre v1** : domaine **weather uniquement** (crypto/copy hors scope).

## 1. Topologie du package

```
packages/backtest/src/
├── index.ts                       runBacktest + parseBacktestParams + createWeatherAdapter
├── params.ts                      schéma Zod backtestRunParamsSchema
├── adapters/
│   ├── backtest-domain-adapter.ts interface BacktestDomainAdapter
│   └── weather/
│       ├── data-loader.ts         chargement SQL (pagination keyset)
│       ├── weather-adapter.ts     orchestration entrées/sorties
│       ├── context-builder.ts     MarketListItemDto + ForecastRevisionStore
│       ├── question-builder.ts    synthèse question pour parseWeatherQuestion
│       ├── resolution.ts          résolution par proxy forecast
│       ├── clocked-weather-forecast.strategy.ts  injecte clock.now() dans evaluate
│       └── weather-adapter.test.ts
└── engine/
    ├── virtual-clock.ts
    ├── events.ts
    ├── event-bus.ts
    ├── ledger.ts
    ├── fill-engine.ts
    ├── exit-manager.ts
    ├── stats.ts
    ├── stats.test.ts
    └── runner.ts
```

## 2. Primitives du moteur

### `VirtualClock` (`engine/virtual-clock.ts`)
`now(): Date`, `advanceTo(t)`. Garde anti-retour : toute régression temporelle lève
une erreur (détecte des données mal triées).

### `EventBus` (`engine/event-bus.ts`)
Min-heap trié par timestamp. Les types d'événements (`events.ts`) :
`book_tick`, `forecast`, `signal`, `timer`. Pour timestamps égaux, ordre
déterministe (insertion).

### `Ledger` (`engine/ledger.ts`)
Cash initial + positions ouvertes en mémoire. `openPositions()`,
`recordFill`, `closePosition`, `equityAt(t)` = cash + mark-to-market des
positions ouvertes.

### `FillEngine` (`engine/fill-engine.ts`)
Fill d'entrée/sortie simulé : prix YES du tick × (1 ± `slippageBps`) ; fees via
`computeTakerFee` (`@polywatch/core`). Pas de profondeur de book → PnL indicatif.

### `StatsComputer` (`engine/stats.ts`)
`computeStats` : PnL total, equity finale, win rate, profit factor, avg win/loss,
expectancy, **max drawdown** (calculé sur les points d'equity).

### `BacktestRunner` (`engine/runner.ts`)
Boucle `while (event = bus.next()) { clock.advanceTo(event.at); adapter.handle(event); }`.
Yields `setImmediate` toutes les 5000 événements. Persiste la progression, les
positions (`meta_json`), et les points d'equity.

## 3. Adaptateur weather

### `data-loader.ts` — pagination keyset
Charge `weather_forecast_history`, `weather_market_snapshots`,
`weather_bucket_ticks`, `weather_evaluation_log` par chunks de 5000 lignes
(`WHERE id > lastId ORDER BY id ASC`). Évite `SELECT *` en mémoire et
fonctionne sous `pg-mem` (tests). Résout la ville via jointure sur
`weather_market_snapshots`.

### `context-builder.ts`
Reconstruit le `MarketListItemDto` à partir des snapshots/ticks pour la
ré-évaluation de la stratégie. Maintient un `ForecastRevisionStore` (dernier
forecast par ville) pour les sorties drift.

### `question-builder.ts`
Synthetise une question Polymarket parseable par `parseWeatherQuestion`.
Retourne `null` si la métrique n'est pas `highest_temp`/`lowest_temp`
(`unsupported_metric_or_bucket`).

### `weather-adapter.ts`
- Mode `reevaluate` : à chaque tick, reconstruit le contexte et appelle
  `ClockedWeatherForecastStrategy.evaluate` → décision d'entrée.
- Mode `replay` : entre sur les décisions `signal` de `weather_evaluation_log`.
- **Sorties** : évaluées **pour toutes les positions ouvertes** à chaque
  `book_tick`, via un cache `lastTickByCondition` (pas seulement la position
  dont le `conditionId` matche le tick entrant).
- Résolution : si `endDate` est nul, fallback `targetDateIso + 24h`
  (`resolution_no_endate_fallback`).

## 4. Exits (`engine/exit-manager.ts`)

| Raison | Condition |
|--------|-----------|
| `WEATHER_PRE_CLOSE` | `hoursToEnd <= closeBeforeResolutionHours` (prioritaire) |
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > threshold` |
| `WEATHER_BUCKET_EXIT` | forecast hors palier + hysteresis en mémoire |
| `SL` / `TP` / `TRAILING` | offsets depuis le prix d'entrée |
| `RESOLUTION` | marché résolu |

SL/TP/trailing : comparaison directe `bid` vs seuils (`impliedBid` supprimé —
tautologie).

## 5. Intégration backend

- Router : `packages/backend/src/routes/backtest.ts`, monté sous `/api/backtest` (JWT).
- `runBacktest` exécute in-process (yields), la UI **polle** `GET /runs/:id`.
- Verrou singleton : `BacktestRunService.hasActiveRun` (running **ou** queued) →
  `409` sur `POST /runs`.
- `recoverOrphanedBacktestRuns` au boot backend → runs orphelins `failed`.

## 6. Dépendances

`@polywatch/core` (entités, services, fees), `@polywatch/weather-algo`
(`WeatherForecastStrategy` via `public-api.ts`). Le live ne dépend jamais du backtest.

## 7. Tests

- `engine/stats.test.ts` — Ledger, `computeStats`, `computeMaxDrawdown`.
- `adapters/weather/weather-adapter.test.ts` — replay, meta persisté, limite
  positions, résolution fallback, metric non supporté, hors plage.
- `packages/core/src/services/backtest-run.service.test.ts` — verrou singleton.
