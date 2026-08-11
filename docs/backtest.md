# Package `@polywatch/backtest` — Moteur de backtest événementiel

Module de **backtest historique** pour la stratégie météo (`weather-algo`) : rejoue
les données persistées (`weather_forecast_history`, `weather_market_snapshots`,
`weather_bucket_ticks`, `weather_evaluation_log`) sur une **horloge virtuelle**
déterministe, réutilise la logique métier live (`WeatherForecastStrategy`), et
produit positions, equity, statistiques et avertissements de fidélité.

> **Périmètre v1** : domaine **weather uniquement**. Les adaptateurs crypto/copy,
> Prometheus et Socket.IO décrits dans le plan d'origine ne sont **pas** implémentés.  
> **Moteur** : `engineVersion` **`0.2.0`** (patch fidélité audit —
> [`plans/applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](./plans/applied/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)).  
> Runs `< 0.2.0` non comparables.

---

## 1. Vue d'ensemble

```
DataSource (PostgreSQL)
      │  loadWeatherEvents (data-loader, pagination keyset)
      ▼
AsyncIterable<BacktestEvent>  ──►  mergeEventStreams (k-way, heap borné)
                                        │
                                        ▼
                        BacktestRunner (horloge virtuelle + boucle streaming)
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
              WeatherBacktestAdapter            Ledger (cash, positions,
              (entrées + sorties weather)        mark-to-market)
                        │                               │
                        └───────────────┬───────────────┘
                                        ▼
                        computeStats → BacktestRunService (DB)
```

### Principes

- **Déterminisme** : les décisions de trading utilisent uniquement `VirtualClock`
  (avancée par le runner à chaque événement). `Date.now()` n'intervient que pour
  le throttle de persistance de progression (~2 s wall-clock).
- **Réutilisation métier** : le mode `reevaluate` réutilise la stratégie choisie
  (`createWeatherStrategy(strategyId)` + wrapper `ClockedWeatherStrategy` qui injecte
  `now`). Avec `backtestExecutionMode=strategy` (défaut) : évaluation **par tick /
  bucket**. Avec `runner-sim` : regroupement ville/date + `evaluateGroup` + dedup /
  selectionMode (proche live ; l'UI passe un seul `strategyId`). Les seuils
  SL/TP/trailing sont résolus via `resolveWeatherEntryExitParams`. Le mode `replay`
  rejoue les décisions `signal` déjà enregistrées.
- **Fidélité explicite** : chaque approximation est consignée dans
  `fidelity_warnings` et affichée dans l'UI du run.
- **Mémoire bornée** : pagination keyset `(timestamp, id)` par source + **merge k-way**
  (heap ≤ 3 têtes), jamais de buffer de tous les events en RAM.

### Ordre temporel (prérequis du moteur)

Le `VirtualClock` exige un flux **monotone croissant** sur `event.at`. Deux
invariants garantissent cela :

1. **Chaque stream SQL** est paginé en `ORDER BY <timestamp> ASC, id ASC` avec
   curseur keyset `(lastAt, lastId)` — jamais `ORDER BY id` seul (les inserts
   multi-villes peuvent avoir un id plus grand et un timestamp plus ancien).
2. **`mergeEventStreams`** fusionne les têtes des streams via un min-heap ; chaque
   insertion initiale appelle `bubbleUp` (sinon le stream 0 est toujours émis
   en premier, même s'il est plus tardif).

Si l'un de ces invariants est violé, le runner lève
`virtual_clock_regression: tried to advance from … to …`.

### Limites de fidélité documentées (warnings)

Les codes statics (`fill_*`, `risk_*`, `detection_delay_*`) sont émis **à la
première tentative d'entrée** (`canEnter`), pas au démarrage du run. Les codes
de résolution / metric sont émis quand le cas survient (`warnOnce`).

| Code | Signification |
|------|---------------|
| `fill_no_book_depth` | Pas de profondeur L2 — fills non plafonnés par liquidité |
| `risk_sl_confirmation_ignored` | SL déclenché au 1er tick (pas de confirmation ticks live) |
| `risk_sizing_simplified_fixed_usdc` | Taille fixe `entryUsdc` (pas de signal-score sizing) |
| `risk_min_time_to_close_ignored` | `minTimeToClose` non appliqué (`closeBeforeHours` l’est à l’entrée) |
| `detection_delay_unused` | `detectionDelayMs > 0` paramétré mais non appliqué |
| `market_lifecycle_filtered` | Ticks exclus (`closed` / `acceptingOrders` / token / minHours) — compteur |
| `kill_switch_force_close` | `force_close_all` a clôturé les positions ouvertes |
| `kill_switch_block_entries` | Kill-switch actif sans force-close — entrées bloquées |
| `exit_stale_tick` | Sortie évaluée avec un tick plus vieux que `pollMs` |
| `no_events_in_range` | Aucune donnée sur la plage demandée |
| `resolution_proxy_forecast` | Résolution approximée via forecast (pas température observée) |
| `resolution_no_endate_fallback` | `endDate` absent → fallback `targetDateIso T23:59:59Z + 24h` |
| `resolution_no_forecast` | Résolution impossible sans forecast — position laissée ouverte |
| `resolution_invalid_date` | Date de résolution invalide — skip |
| `unsupported_metric_or_bucket` | Marché ignoré (metric non `highest_temp`/`lowest_temp`) |

Garde-fous **implémentés** en backtest (reevaluate **et** replay) :
`maxExposure`, `maxDailyLoss` (+ `force_close_all` → `KILL_SWITCH`), cash insuffisant,
one-thesis-per-city, throttle re-entry **uniquement** après
`WEATHER_BUCKET_EXIT` / `WEATHER_FORECAST_CHANGE`, filtre cycle de vie marché
(`isMarketActiveForWeather`), hystérésis bucket calée sur `weatherAlgoPollMs`.

---

## 2. Modes de run

| Mode | Comportement | Usage |
|------|--------------|-------|
| `reevaluate` | À chaque `book_tick` : reconstruit le contexte marché + forecast as-of et appelle `WeatherForecastStrategy.evaluate` → décide l'entrée | Tester une stratégie sur données passées |
| `replay` | Entre sur chaque décision `signal` déjà enregistrée dans `weather_evaluation_log` (pas de re-stratégie) | Simuler l'exécution des décisions passées |

Les **sorties** (drift / bucket-exit / pre-close / SL-TP-trailing / kill-switch /
résolution) sont évaluées en mémoire à chaque `book_tick` pour **toutes** les
positions ouvertes (via cache `lastTickByCondition`, pas seulement le
`conditionId` du tick courant). En `reevaluate`, les entrées passent par
`isMarketActiveForWeather` avant l’appel stratégie.

---

## 3. Architecture du package

### 3.1 Noyau moteur (`src/engine/`)

| Fichier | Rôle |
|---------|------|
| `virtual-clock.ts` | Horloge virtuelle `now()` / `advanceTo(t)` avec garde anti-retour |
| `events.ts` | Types d'événements `book_tick`, `forecast`, `signal`, `timer` |
| `merge-event-streams.ts` | Merge k-way de streams async par timestamp |
| `ledger.ts` | Cash + positions ; mark-to-market via `markPrice` courant (`peakBid` seulement pour trailing) |
| `fill-engine.ts` | Fill d'entrée/sortie simulé : `yesPrice × (1 ± slippageBps)` + `computeTakerFee` |
| `exit-manager.ts` | Sorties weather (drift, bucket + hystérésis `pollMs`, pre-close, SL/TP via meta résolue) ; throttle **bucket/drift seulement** |
| `stats.ts` | `computeStats` (PnL, win rate, `profitFactor` null = ∞, expectancy, max drawdown, byExit/byCity) |
| `engine-version.ts` | `BACKTEST_ENGINE_VERSION` (semver, écrit dans `backtest_runs.engine_version`) |
| `runner.ts` | Boucle `for await` : avance la clock, délègue à l'adapter, persiste progression + equity + positions |

### 3.2 Adaptateur weather (`src/adapters/weather/`)

| Fichier | Rôle |
|---------|------|
| `data-loader.ts` | Chargement SQL (keyset) ; replay filtre `decision=signal` + `strategyId` |
| `context-builder.ts` | Reconstruction de `MarketListItemDto` + `ForecastRevisionStore` |
| `question-builder.ts` | Synthèse question Polymarket (targets arrondis entiers) pour la stratégie |
| `clocked-weather-strategy.ts` | Factory `createWeatherStrategy(strategyId)` + wrapper clock |
| `runner-sim.ts` | Simulation runner live (groupes buckets, dedup, selectionMode) |
| `resolution.ts` | Résolution par proxy forecast (moyenne dans le bucket → YES/NO) |
| `weather-adapter.ts` | Entrées/sorties, filtre lifecycle, kill-switch, résolution |

### 3.3 Point d'entrée (`src/index.ts`)

- `runBacktest(input)` : parse les params, applique `configOverrides` sur le snapshot
  config, charge les événements, construit `WeatherBacktestAdapter`, exécute le runner.
- `parseBacktestParams` / `backtestRunParamsSchema` (validation Zod).
- `createWeatherAdapter(ctx)` : export utilitaire (la route backend appelle
  `runBacktest` directement, qui instancie l'adapter elle-même).

---

## 4. Modèle de données

Entités dans `packages/core/src/entities/` (voir [`modele-donnees.md`](./modele-donnees.md)) :

| Table | Rôle |
|-------|------|
| `backtest_runs` | Job : statut, progression, params, snapshot config, fingerprint, stats, warnings, plage |
| `backtest_positions` | Positions simulées (entrée/sortie, prix, PnL, fees, `meta_json`) |
| `backtest_equity_points` | Points d'equity (1/min de temps rejoué) |

`BacktestRunService` (`packages/core/src/services/backtest-run.service.ts`) :
CRUD + transitions de statut (`queued → running → completed/failed/cancelled`),
append positions/equity, récupération des runs orphelins (`running`/`queued` →
`failed` au boot backend).

### Statuts de run

`queued` → `running` → `completed` | `failed` | `cancelled`

### Verrou singleton

Un seul run weather actif à la fois : `BacktestRunService.hasActiveRun` détecte
un run `running` **ou** `queued` → la route `POST /runs` renvoie `409`.

---

## 5. Sorties weather (exits)

Paramètres lus depuis le bag per-strategy
(`getStrategyParams(cfgSnapshot, strategyId)` → `WeatherStrategyParamsBag`).
`strategyId` attaché à chaque position/snapshot ; legacy `null` → fallback
`'weather-forecast'`.

| Raison | Déclencheur |
|--------|-------------|
| `WEATHER_PRE_CLOSE` | `hoursToEnd <= bag.closeBeforeResolutionHours` (prioritaire) — **pas** de throttle re-entry |
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > bag.forecastChangeThreshold` — **pose** le throttle |
| `WEATHER_BUCKET_EXIT` | Forecast hors palier + `bag.cityFollowSwitchMode = close_and_reenter` après `bag.bucketHysteresisPolls` avancées espacées de `weatherAlgoPollMs` — **pose** le throttle |
| `SL` / `TP` / `TRAILING` | Seuils résolus à l’entrée via `resolveWeatherEntryExitParams(risk, mode, interval, strategyId)` (défauts `WEATHER_EXIT_DEFAULTS` si bidPoints null) — **pas** de confirmation ticks, **pas** de throttle |
| `KILL_SWITCH` | `dailyPnl(strategyId) <= -bag.maxDailyLossUsdc` et `bag.killSwitchAction === 'force_close_all'` — ferme uniquement les positions de la stratégie |
| `RESOLUTION` | Marché résolu (`endDate` passé, ou fallback `targetDateIso T23:59:59Z + 24h` si `endDate` absent) |

> **Note** : les runs avec `engineVersion < 0.2.0` ont été produits avant l’alignement
> SL/TP/throttle/filtres — **non comparables** aux runs ≥ `0.2.0`.

---

## 6. Fidélité & avertissements

Voir le tableau §1. Le **fill** est simulé au prix YES enregistré ± slippage, sans
profondeur de book : le PnL est une **borne indicative**, pas une exécution réelle.

---

## 7. Exécution côté backend

- Routes : `packages/backend/src/routes/backtest.ts`, montées sous `/api/backtest` (JWT).
- Le run s'exécute **in-process** en async (`yields setImmediate` toutes les 5000
  événements pour ne pas bloquer l'event loop). Progression flushée ~toutes les 2 s
  wall-clock. La UI **polle** le run via `GET /runs/:id` (pas de Socket.IO).
- **Timeout** : `BACKTEST_TIMEOUT_MS` (env, défaut 30 min) → flush equity + positions
  puis `markFailed` (`error: 'timeout'`). Pas de `statsJson` / `fidelityWarningsJson`
  persistés sur timeout (contrairement au cancel).
- **Cancel** : `POST /runs/:id/cancel` répond `{ status: 'cancelling' }` et pose un
  flag coopératif ; le runner flush equity + positions puis marque `cancelled`
  (stats partielles + warnings conservés).
- **Shutdown** : `cancelAllActiveBacktestRuns()` annule les runs in-process avant
  arrêt du backend.
- Au boot, `recoverOrphanedBacktestRuns` marque les runs `running`/`queued`
  orphelins comme `failed` (`error: 'backend_restart'`).

---

## 8. UI

Onglet **Backtest** de la page Weather Algo (`WeatherAlgoBacktestTab` +
`BacktestEquityChart`) :

- **Couverture de données** affichée avant lancement.
- **Formulaire** : mode, période, villes, capital, slippage, entrée USDC, positions max
  (pas d'UI pour `configOverrides` / `detectionDelayMs` — disponibles via API).
- **Liste des runs** : statut, progression, métriques.
- **Détail** : métriques (PnL, win rate, PF avec `∞` si null, expectancy, durée
  moy., répartition par sortie / ville), avertissements de fidélité, message
  d'erreur si `status === failed`. Ligne de capital du chart = `run.params.capital`
  (pas le formulaire). Polling nettoyé au démontage de l’onglet.
- Courbe d'equity + tableau des positions : chargés **uniquement** si
  `status === 'completed'` (un run `cancelled` peut avoir des rows en DB mais
  l'UI ne les fetch pas). Axe X du chart = champ `t` (timestamp ISO des
  `backtest_equity_points`), pas un index.

---

## 9. Tests

- `src/engine/stats.test.ts` : Ledger, `computeStats`, `computeMaxDrawdown`.
- `src/engine/exit-manager.test.ts` : défauts SL/TP, throttle restreint, hystérésis `pollMs`.
- `src/engine/merge-event-streams.test.ts` : merge k-way, régression heap init
  (stream 0 plus tardif que stream 1).
- `src/adapters/weather/weather-adapter.test.ts` : run replay (entrée + résolution),
  meta persisté, limite positions, one-thesis-per-city replay, résolution fallback,
  metric non supporté, hors plage.
- `packages/core/src/services/backtest-run.service.test.ts` : verrou singleton.

Lancement : `npm run test -w @polywatch/backtest` (**24** tests).

---

## 10. Dépannage

| Erreur / symptôme | Cause probable | Action |
|-------------------|----------------|--------|
| `virtual_clock_regression` | Flux non monotone : pagination `ORDER BY id`, ou heap merge non initialisé | Vérifier `data-loader.ts` (`ORDER BY fetchedAt/recordedAt`) et `merge-event-streams.ts` (`bubbleUp` à l'init) ; rebuild `@polywatch/backtest` + redémarrer le backend |
| Run bloqué `running` après crash backend | Run orphelin | Redémarrer le backend (`recoverOrphanedBacktestRuns`) ou marquer manuellement |
| `run_already_active` (409) | Un run weather est déjà `running`/`queued` | Attendre la fin, cancel, ou corriger le run orphelin |
| `run_still_active` (409) sur DELETE | Tentative de suppression d’un run `running`/`queued` | `POST …/cancel` puis DELETE |
| Progression à 0 % longtemps | `countWeatherEvents` retourne 0 ou run très volumineux | Vérifier couverture `/api/backtest/data-coverage` et plage `from`/`to` |
| Positions ouvertes avec `exitPrice = null` | Comportement normal en fin de run | Positions encore ouvertes à la fin de la plage ; persistées avec PnL null |

---

## 11. Hors scope v1

- Adaptateurs **crypto** et **copy trading** (plan d'origine).
- Prometheus (`polywatch_backtest_*`), Socket.IO (`backtest:*`).
- Comparaison A/B de runs, export CSV, grid-search / optimisation.

Plan d'origine : [`plans/2026-08-05_PLAN-backtest-engine-universel.md`](./plans/2026-08-05_PLAN-backtest-engine-universel.md).
