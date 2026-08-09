# Package `@polywatch/backtest` — Moteur de backtest événementiel

Module de **backtest historique** pour la stratégie météo (`weather-algo`) : rejoue
les données persistées (`weather_forecast_history`, `weather_market_snapshots`,
`weather_bucket_ticks`, `weather_evaluation_log`) sur une **horloge virtuelle**
déterministe, réutilise la logique métier live (`WeatherForecastStrategy`), et
produit positions, equity, statistiques et avertissements de fidélité.

> **Périmètre v1** : domaine **weather uniquement**. Les adaptateurs crypto/copy,
> Prometheus et Socket.IO décrits dans le plan d'origine ne sont **pas** implémentés.

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
                        StatsComputer → BacktestRunService (DB)
```

### Principes

- **Déterminisme** : aucune date système dans le chemin de replay — tout passe par
  `VirtualClock` avancée par le runner à chaque événement.
- **Zéro réécriture métier** : le mode `reevaluate` réutilise
  `WeatherForecastStrategy.evaluate` (via `ClockedWeatherForecastStrategy` qui injecte
  `now`). Le mode `replay` rejoue les décisions `signal` déjà enregistrées.
- **Fidélité explicite** : chaque approximation est consignée dans
  `fidelity_warnings` et affichée dans l'UI du run.
- **Mémoire bornée** : pagination keyset par source + **merge k-way** (heap ≤ 3
  têtes), jamais de buffer de tous les events en RAM.

### Limites de fidélité documentées (warnings)

Le run émet des `fidelity_warnings` explicites, notamment :

| Code | Signification |
|------|---------------|
| `fill_no_book_depth` | Pas de profondeur L2 — fills non plafonnés par liquidité |
| `risk_sl_confirmation_ignored` | SL déclenché au 1er tick (pas de confirmation ticks live) |
| `risk_sizing_simplified_fixed_usdc` | Taille fixe `entryUsdc` (pas de signal-score sizing) |
| `risk_min_time_to_close_ignored` | `minTimeToClose` non appliqué |
| `detection_delay_unused` | `detectionDelayMs` paramétré mais non appliqué |
| `resolution_proxy_forecast` | Résolution approximée via forecast (pas température observée) |

Garde-fous **implémentés** en backtest : `maxExposure`, `maxDailyLoss`, cash
insuffisant, one-thesis-per-city.

---

## 2. Modes de run

| Mode | Comportement | Usage |
|------|--------------|-------|
| `reevaluate` | Reconstruit le contexte marché + forecast et appelle `WeatherForecastStrategy.evaluate` à chaque tick → décide l'entrée | Tester une stratégie sur données passées |
| `replay` | Entre sur chaque décision `signal` déjà enregistrée dans `weather_evaluation_log` | Simuler l'exécution des décisions passées |

Les **sorties** (drift / bucket-exit / pre-close / SL-TP-trailing / résolution) sont
évaluées en mémoire à chaque tick qui met à jour le prix d'une position ouverte.

---

## 3. Architecture du package

### 3.1 Noyau moteur (`src/engine/`)

| Fichier | Rôle |
|---------|------|
| `virtual-clock.ts` | Horloge virtuelle `now()` / `advanceTo(t)` avec garde anti-retour |
| `events.ts` | Types d'événements `book_tick`, `forecast`, `signal`, `timer` |
| `event-bus.ts` | Min-heap (legacy / tests) |
| `merge-event-streams.ts` | Merge k-way de streams async par timestamp |
| `ledger.ts` | Cash + positions ; mark-to-market via `markPrice` courant |
| `fill-engine.ts` | Fill d'entrée/sortie simulé : `yesPrice × (1 ± slippageBps)` + `computeTakerFee` |
| `exit-manager.ts` | Sorties weather en mémoire (drift, bucket-exit + hysteresis, pre-close, SL/TP/trailing) |
| `stats.ts` | `computeStats` (PnL, win rate, profit factor, expectancy, max drawdown) |
| `runner.ts` | Boucle événementielle : avance la clock, délègue à l'adapter, persiste progression + equity + positions |

### 3.2 Adaptateur weather (`src/adapters/weather/`)

| Fichier | Rôle |
|---------|------|
| `data-loader.ts` | Chargement des événements depuis PostgreSQL (pagination keyset) |
| `context-builder.ts` | Reconstruction de `MarketListItemDto` + `ForecastRevisionStore` |
| `question-builder.ts` | Synthèse d'une question Polymarket parser pour la stratégie |
| `clocked-weather-forecast.strategy.ts` | Wrapper injectant `clock.now()` dans `evaluate` |
| `resolution.ts` | Résolution par proxy forecast (moyenne dans le bucket → YES/NO) |
| `weather-adapter.ts` | Orchestration entrées/sorties pour `reevaluate` et `replay` |

### 3.3 Point d'entrée (`src/index.ts`)

- `runBacktest(input)` : charge les événements, construit l'adapter weather, exécute le runner.
- `parseBacktestParams` / `backtestRunParamsSchema` (validation Zod).
- `createWeatherAdapter(ctx)` : fabrique d'adapter pour la route backend.

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

| Raison | Déclencheur |
|--------|-------------|
| `WEATHER_PRE_CLOSE` | `hoursToEnd <= weatherAlgoCloseBeforeResolutionHours` (prioritaire) |
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > weatherAlgoForecastChangeThreshold` |
| `WEATHER_BUCKET_EXIT` | Forecast hors palier + `close_and_reenter` après `bucketHysteresisPolls` polls consécutifs |
| `SL` / `TP` / `TRAILING` | Seuils `weatherAlgo*BidPoints` (offsets depuis le prix d'entrée) |
| `RESOLUTION` | Marché résolu (endDate passé, ou fallback `targetDateIso + 24h` si endDate absent) |

---

## 6. Fidélité & avertissements

Chaque approximation est signalée dans `fidelity_warnings` (affiché dans l'UI) :

| Code | Signification |
|------|---------------|
| `no_events_in_range` | Aucune donnée sur la plage demandée |
| `resolution_proxy_forecast` | Résolution approximée par le forecast final (pas d'observation réelle) |
| `resolution_no_endate_fallback` | Résolution via `targetDateIso+24h` (endDate absent) |
| `unsupported_metric_or_bucket` | Marché ignoré (metric non `highest_temp`/`lowest_temp`) |

Le **fill** est simulé au prix YES enregistré ± slippage, sans profondeur de book :
le PnL est une **borne indicative**, pas une exécution réelle.

---

## 7. Exécution côté backend

- Routes : `packages/backend/src/routes/backtest.ts`, montées sous `/api/backtest` (JWT).
- Le run s'exécute **in-process** en async (`yields setImmediate` toutes les 5000
  événements pour ne pas bloquer l'event loop). La UI **polle** le run via
  `GET /runs/:id` (pas de Socket.IO).
- Au boot, `recoverOrphanedBacktestRuns` marque les runs `running`/`queued`
  orphelins comme `failed` (`error: 'backend_restart'`).

---

## 8. UI

Onglet **Backtest** de la page Weather Algo (`WeatherAlgoBacktestTab` +
`BacktestEquityChart`) :

- **Couverture de données** affichée avant lancement.
- **Formulaire** : mode, période, villes, capital, slippage, entrée USDC, positions max.
- **Liste des runs** : statut, progression, métriques.
- **Détail** : métriques (PnL, win rate, PF, max drawdown), courbe d'equity,
  tableau des positions, avertissements de fidélité.

---

## 9. Tests

- `src/engine/stats.test.ts` : Ledger, `computeStats`, `computeMaxDrawdown`.
- `src/adapters/weather/weather-adapter.test.ts` : run replay (entrée + résolution),
  meta persisté, limite positions, résolution fallback, metric non supporté, hors plage.
- `packages/core/src/services/backtest-run.service.test.ts` : verrou singleton.

Lancement : `npm run test -w @polywatch/backtest`.

---

## 10. Hors scope v1

- Adaptateurs **crypto** et **copy trading** (plan d'origine).
- Prometheus (`polywatch_backtest_*`), Socket.IO (`backtest:*`).
- Comparaison A/B de runs, export CSV, grid-search / optimisation.

Plan d'origine : [`plans/2026-08-05_PLAN-backtest-engine-universel.md`](./plans/2026-08-05_PLAN-backtest-engine-universel.md).
