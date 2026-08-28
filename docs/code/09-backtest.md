# Package `@polywatch/backtest` — moteur de backtest événementiel (weather)

> **Vue d'ensemble produit** : [`../reference/backtest.md`](../reference/backtest.md).  
> **Plan d'origine** : [`../plans/2026-08-05_PLAN-backtest-engine-universel.md`](../plans/2026-08-05_PLAN-backtest-engine-universel.md).  
> **Patch fidélité 0.2.0** : [`../weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](../weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md).  
> **Audit fidélité/correctude 0.3.0** : [`../audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](../audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md) + [`../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md).  
> **Audit moteur 0.4.0** : [`../audits/2026-08-19_audit-weather-backtest-moteur.md`](../audits/2026-08-19_audit-weather-backtest-moteur.md).  
> **Per-strategy risk guards 0.5.0** : [`../audits/2026-08-21_audit-weather-backtest-per-strategy-risk.md`](../audits/2026-08-21_audit-weather-backtest-per-strategy-risk.md).  
> **Entrée runner-sim 0.8.0** : [`../audits/2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md`](../audits/2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md).  
> **Périmètre v1** : domaine **weather uniquement** (crypto/copy hors scope).

## 1. Topologie du package

```
packages/backtest/src/
├── index.ts                       runBacktest + parseBacktestParams + BACKTEST_ENGINE_VERSION
├── params.ts                      schéma Zod backtestRunParamsSchema (+ configOverrides)
├── engine-version.ts              semver moteur (`0.8.0`)
├── adapters/
│   ├── backtest-domain-adapter.ts interface BacktestDomainAdapter
│   └── weather/
│       ├── data-loader.ts         chargement SQL (keyset) ; filtre strategyId/cities/fidelityMinutes
│       ├── weather-adapter.ts     orchestration entrées/sorties (+ kill-switch, lifecycle)
│       ├── context-builder.ts     MarketListItemDto + ForecastRevisionStore
│       ├── question-builder.ts    synthèse question (entiers °C) pour parseWeatherQuestion
│       ├── clocked-weather-strategy.ts  factory createWeatherStrategy + clock
│       ├── runner-sim.ts                mode runner-sim (proche live)
│       └── weather-adapter.test.ts
└── engine/
    ├── virtual-clock.ts
    ├── events.ts                  book_tick | forecast
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
edge, bucket, `strategyId`…) stockés sur chaque position. `openExposure(strategyId?)`
et `dailyRealizedPnl(at, strategyId?)` acceptent un filtre optionnel par `strategyId`
(depuis 0.5.0) — retournent l'exposition/PnL d'une seule stratégie ou de toutes si
omis.

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

Pagination : chunks de 5000, `ORDER BY <timestamp> ASC, id ASC`, curseur
`(lastAt, lastId)` via `applyTimeIdCursor`. **Ne jamais paginer par `id` seul**.

En `reevaluate`, `strategyId` peut être n'importe quel ID du catalogue (dont
`weather-highest-yes`, instancié sans forecast).

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
  `closeBeforeHours` sur horloge virtuelle), puis exécute en `runner-sim`
  (uniquement) : `runner-sim.ts` regroupe les ticks, `evaluateGroup`, dedup /
  selectionMode (un `strategyId` forcé depuis les params UI).
  Les events `forecast` mettent à jour le store (pas d'évaluation stratégie).
- **Garde-fous** : `maxExposure`, `maxDailyLoss` (+
  `force_close_all` → clôture `KILL_SWITCH`), cash insuffisant,
  capacité `maxPositionsPerCityDate` par ville+date (`targetDateIso` sur le ledger ;
  un run a un seul `strategyEnv`, donc la clé n'inclut pas `mode` — contrairement
  au live `city|date|strategyId|mode`),
  `maxPositionSizeUsdc`, throttle re-entry ville+date (bucket/drift seulement).
  **Depuis 0.5.0**, ces garde-fous sont résolus **par stratégie** :
  `canEnter(ctx, entryUsdc, yesPrice, strategyId)` utilise
  `getStrategyParamsForMode(cfgSnapshot, strategyId, strategyEnv)` pour le bag
  (pas `this.bag` global) ;
  `isDailyLossBreached(ctx, strategyId)` filtre `dailyRealizedPnl` par stratégie ;
  `maybeForceCloseAll` groupe les positions par `strategyId` et n'évalue le
  kill-switch que pour les stratégies dont le daily loss est atteint, en ne fermant
  que leurs positions.
- À l’entrée : `resolveWeatherEntryExitParams` → `meta.slPercent` / `tpPercent` / `trailing*`.
- **Sorties** : évaluées pour **toutes** les positions ouvertes à chaque
  `book_tick`, via `lastTickByCondition` (+ `at` pour warning `exit_stale_tick`).
  `evaluateExits` opère une **garde explicite `isHighestYes`** : drift/bucket-exit
  ne sont **pas** appliqués à `weather-highest-yes` (aligné sur le live). En
  `runner-sim` multi-stratégies, chaque position utilise son bag
  (`getStrategyParamsForMode(risk, pos.meta.strategyId, strategyEnv)`) — voir `exit-manager.ts`.
- **Entrée runner-sim (0.8.0)** : signaux bufferisés avec `decidedAt` ; flush
  coalescé (1 s) via `maybeFlushRunnerSimBatch` ; `entryAt` = décision ; gardes
  `entry_skipped_market_resolved`, `entry_skipped_stale_price`,
  `entry_skipped_immediate_sl` ; flush du batch précédent **avant** duplicate /
  maxPos / throttle (signaux non retenus **droppés**, pas de file) ; `decidedAt`
  re-pairé par identité d’objet (`pairDecidedAtBySignal`) ; `fill_price_clamped`
  seulement si la position s’ouvre (après garde SL immédiat).
- `markPrice` / `peakBid` : si `tick.yesPrice == null`, garde défensive
  `markprice_stale_carry_forward` (confirme la dernière valeur connue, `peakBid`
  non touché — invariant `fallbackPrice <= peakBid`).
- Résolution par prix YES : `yesPrice >= 0.99` → YES (`exitPrice = 1`),
  `yesPrice <= 0.01` → NO (`exitPrice = 0`), **1 tick suffit** (pas de durée de
  maintien). Fallback si `tick.yesPrice` absent : `markPrice` uniquement
  (warnings `resolution_by_price` / `resolution_price_fallback` /
  `resolution_no_price_whatsoever`) — **plus de fallback `entryPrice` depuis 0.6.0**.
  Le forecast n'est plus utilisé pour la résolution (abandon total).
  Une résolution appelle `exitManager.markClosed` (throttle ville+date+stratégie).
- **Ghost positions** : à la fin du run (`finish`), les positions encore ouvertes
  sont fermées au dernier `markPrice` (ou `entryPrice`) avec
  `exitReason = BACKTEST_INCOMPLETE_DATA` + warning
  `ghost_positions_forced_resolution`. Depuis 0.4.0, `adapter.finish` est aussi
  appelé sur les chemins `cancelled`/`timeout` (pas seulement `completed`), et un
  check d'abort final après épuisement des événements évite de terminer en
  `completed` alors qu'un cancel/timeout était en attente.

### `index.ts` — `configOverrides`
`runBacktest` fusionne `params.configOverrides` (`z.record(z.unknown())`, shallow
merge) sur le snapshot `WeatherConfig` **avant** le run. La route backend stocke
néanmoins `configSnapshotJson` / fingerprint **avant** overrides (config live).
`BACKTEST_ENGINE_VERSION` est écrit dans `backtest_runs.engine_version` au launch.

`applyConfigOverrides` valide les overrides : clés préfixées `weatherAlgo`
uniquement (`simWeatherAlgo*` / `realWeatherAlgo*` sont **rejetées**),
valeurs primitives (string/number/boolean/null). Depuis la section « Config
stratégie » du formulaire, `weatherAlgoStrategyParams` (string JSON) est
**sanitisé + validé** (`sanitizeWeatherStrategyParams` +
`validateWeatherStrategyParamsUpdate`, mêmes règles que le PUT `/config/weather`)
avant fusion — une valeur malformée ou hors bornes lève une erreur claire au lieu
de produire des comparaisons NaN silencieuses. Après validation, le patch est
**copié** vers `simWeatherAlgoStrategyParams` ou `realWeatherAlgoStrategyParams`
selon `strategyEnv` (défaut `'sim'`). L'override remplace la map entière
(`{ ...config, ...overrides }` puis copie env), donc le frontend fusionne la
partial live stockée avec les champs modifiés avant d'envoyer.

## 4. Exits (`engine/exit-manager.ts`)

| Raison | Condition | Throttle re-entry |
|--------|-----------|-------------------|
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > threshold` | **Oui** — *non applicable à `weather-highest-yes` en live (évalué en backtest)* |
| `WEATHER_BUCKET_EXIT` | hors palier + `close_and_reenter` après `hysteresisPolls` avancées espacées de `weatherAlgoPollMs` | **Oui** — *non applicable à `weather-highest-yes` en live (évalué en backtest)* |
| `SL` | seuil résolu à l'entrée (`meta.slPercent`) | **Oui** (throttle `reentryThrottleAfterSlMs` ville+date+stratégie) |
| `TP` / `TRAILING` | seuils résolus à l'entrée (`meta.*Percent`) ; `peakBid` pour trailing | Non |
| `KILL_SWITCH` | géré dans l'adapter (daily loss per-strategy + `force_close_all`) — ferme **uniquement** les positions de la stratégie déclenchée | Non |
| `RESOLUTION` | marché résolu (adapter, pas ExitManager) ; `tryResolveByPrice` appelle `markClosed` | **Oui** (throttle ville+date+stratégie) |

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
(`WeatherForecastStrategy`, `WeatherHighestYesStrategy` via `public-api.ts`).
Le live ne dépend jamais du backtest.

## 7. Tests

- `engine/stats.test.ts` — Ledger, `computeStats`, `computeMaxDrawdown`.
- `engine/exit-manager.test.ts` — défauts SL/TP, throttle restreint, hystérésis `pollMs`.
- `engine/merge-event-streams.test.ts` — ordre temporel, régression heap init.
- `adapters/weather/weather-adapter.test.ts` — reevaluate, meta persisté, limite
  positions, résolution fallback, metric non supporté, hors plage,
  carry-forward markPrice, garde highest-yes drift/bucket,
  **garde-fous per-strategy** (filtrage `openExposure`/`dailyRealizedPnl` par `strategyId`,
  `maxExposureUsdc` par stratégie bloque 2e entrée, `maxExposureUsdc` généreux autorise
  multiple entrées), **entrée runner-sim 0.8.0** (`entryAt` = décision, coalesce, skip marché résolu /
  prix stale / SL immédiat, `maybeFlushRunnerSimBatch` avant gardes — drop pas de file,
  `pairDecidedAtBySignal`, tests F4 throttle + F5 pairing).
- `packages/core/src/services/backtest-run.service.test.ts` — verrou singleton.

Lancement : `npm run test -w @polywatch/backtest`.
