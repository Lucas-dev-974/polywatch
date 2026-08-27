# Package `@polywatch/backtest` — Moteur de backtest événementiel

Module de **backtest historique** pour la stratégie météo (`weather-algo`) : rejoue
les données persistées (`weather_forecast_history`, `weather_market_snapshots`,
`weather_bucket_ticks`, `weather_evaluation_log`) sur une **horloge virtuelle**
déterministe, réutilise la logique métier live (stratégie du catalogue via
`createWeatherStrategy`, dont `weather-highest-yes` sans forecast), et
produit positions, equity, statistiques et avertissements de fidélité.

> **Périmètre v1** : domaine **weather uniquement**. Les adaptateurs crypto/copy,
> Prometheus et Socket.IO décrits dans le plan d'origine ne sont **pas** implémentés.  
> **Moteur** : `engineVersion` **`0.8.0`** (audit moteur —
> [`audits/2026-08-19_audit-weather-backtest-moteur.md`](../audits/2026-08-19_audit-weather-backtest-moteur.md) ;
> per-strategy risk guards —
> [`audits/2026-08-21_audit-weather-backtest-per-strategy-risk.md`](../audits/2026-08-21_audit-weather-backtest-per-strategy-risk.md) ;
> audit complet —
> [`audits/2026-08-23_audit-weather-backtest-complet.md`](../audits/2026-08-23_audit-weather-backtest-complet.md) ;
> zero-holding / fill stale —
> [`audits/2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md`](../audits/2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md)).  
> Runs `< 0.5.0` non comparables (résolution per-strategy des garde-fous risk).  
> Runs `0.5.0` non comparables aux `0.6.0` (warning agrégé `multi_position_stale_mark`,
> clamping prix [0,1], retrait du fallback `entryPrice` en résolution).  
> Runs `0.6.0` non comparables aux `0.7.0` (entrée runner-sim : `entryAt` = décision,
> coalesce 1 s, gardes marché résolu / prix stale / SL immédiat).  
> Runs `0.7.0` non comparables aux `0.8.0` (flush avant duplicate/maxPos/throttle,
> pairing `decidedAt` par identité d’objet, `fill_price_clamped` après la garde SL).

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
  `now`). L'exécution utilise `runner-sim` : regroupement ville/date + `evaluateGroup` + dedup /
  selectionMode (proche live ; l'UI passe un seul `strategyId`). Les seuils
  SL/TP/trailing sont résolus via `resolveWeatherEntryExitParams`. Le mode `replay`
  rejoue les décisions `signal` déjà enregistrées.
- **Consolidation 2026-08-24** : le backtest s'exécute désormais **uniquement en
  `runner-sim`** (regroupement buckets, `evaluateGroup`, dedup, selectionMode comme
  le live). Le mode `strategy` (ré-évaluation bucket par bucket, non équivalent
  live) a été retiré du moteur. Le champ `backtestExecutionMode` reste accepté par
  le schéma pour rétro-compat API mais est **ignoré** au runtime.
- **Sizing par stratégie** : le fill d'entrée honore le `sizingMode` du bag de la
  stratégie émettrice — `fixed_usdc` (défaut, `qty = entryUsdc / price`) ou
  `fixed_shares` (`qty = min(fixedShareCount, budget/price)`, miroir du live
  `computeFixedSharesQuantity`). Un `sizingMode` non supporté émet le warning
  `risk_sizing_mode_ignored` et retombe en USDC fixe.
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

Les codes statics (`fill_*`, `risk_*`) sont émis **à la
première tentative d'entrée** (`canEnter`), pas au démarrage du run. Les codes
de résolution / metric sont émis quand le cas survient (`warnOnce`).

| Code | Signification |
|------|---------------|
| `fill_no_book_depth` | Pas de profondeur L2 — fills non plafonnés par liquidité |
| `risk_sl_confirmation_ignored` | SL déclenché au 1er tick (pas de confirmation ticks live) |
| `risk_sizing_simplified_fixed_usdc` | Taille fixe (`entryUsdc` ou `fixedShareCount` selon le mode) — pas de signal-score sizing |
| `risk_sizing_mode_ignored` | `sizingMode` non supporté par le backtest → taille en USDC fixe (fidélité réduite) |
| `risk_min_time_to_close_ignored` | `minTimeToClose` non appliqué (le backtest n'implémente pas ce gate runtime) |
| `market_lifecycle_filtered` | Ticks exclus (`closed` / `acceptingOrders` / token / minHours) — compteur |
| `kill_switch_force_close` | `force_close_all` a clôturé les positions ouvertes |
| `kill_switch_partial_close` | `force_close_all` a échoué sur ≥1 position (close en erreur / positions restantes) — retry au prochain tick |
| `kill_switch_block_entries` | Kill-switch actif sans force-close — entrées bloquées |
| `exit_stale_tick` | Sortie évaluée avec un tick plus vieux que `pollMs` |
| `multi_position_stale_mark` | N positions ouvertes évaluées avec un tick plus vieux que `pollMs` (markPrice lag-1 par condition) |
| `fill_price_clamped` | Prix de fill clampé à la borne [0,1] (slippage hors bornes) ; entrée runner-sim : émis seulement si la position s’ouvre (après garde SL immédiat, depuis 0.8.0) |
| `no_events_in_range` | Aucune donnée sur la plage demandée |
| `resolution_by_price` | Résolution par prix YES (`>= 0.99` → YES / `<= 0.01` → NO) — pas de température observée |
| `resolution_price_fallback` | Résolution via fallback `markPrice` (`tick.yesPrice` absent — plus de fallback `entryPrice` depuis 0.6.0) |
| `resolution_no_price_whatsoever` | Résolution impossible — aucun prix disponible (tick, mark) — position laissée ouverte |
| `markprice_stale_carry_forward` | `markPrice` confirmé à la dernière valeur connue car `tick.yesPrice` est null (garde défensive) |
| `ghost_positions_forced_resolution` | Position(s) encore ouverte(s) en fin de run — résolution forcée (`BACKTEST_INCOMPLETE_DATA`) |
| `unsupported_metric_or_bucket` | Marché ignoré (metric non `highest_temp`/`lowest_temp`) |
| `entry_skipped_market_resolved` | Entrée runner-sim ignorée : le **tick courant** est déjà collé aux bornes (`yesPrice <= 0.01` ou `>= 0.99`). Le fill reste au prix de décision ; cette garde lit le cache courant pour ne pas ouvrir puis résoudre 10 ms plus tard |
| `entry_skipped_stale_price` | Entrée runner-sim ignorée : écart prix de décision vs tick courant > 0.10 au flush (fill hors courbe évité) |
| `entry_skipped_immediate_sl` | Entrée runner-sim ignorée : le tick courant déclencherait le SL dès l’ouverture |

Garde-fous **implémentés** en backtest (reevaluate **et** replay) :
`maxExposure`, `maxDailyLoss` (+ `force_close_all` → `KILL_SWITCH`), cash insuffisant,
one-thesis-per-city-date (`maxPositionsPerCityDate`), `maxPositionSizeUsdc`, throttle re-entry **ville+date** **uniquement** après
`WEATHER_BUCKET_EXIT` / `WEATHER_FORECAST_CHANGE`, filtre cycle de vie marché
(`isMarketActiveForWeather`), hystérésis bucket calée sur `weatherAlgoPollMs`.

### Limitations de fidélité (0.8.0)

- **Mark lag-1 par condition** : le backtest ne dispose que des ticks **observés**
  pour chaque `conditionId`. Le `markPrice` d'une position ne peut pas être plus
  frais que son dernier tick observé. Si un tick est plus vieux que `weatherAlgoPollMs`,
  le warning agrégé `multi_position_stale_mark` est émis.
- **Trailing peak lag-1** : le pic du trailing stop d'une position n'avance que sur
  son **propre** tick. Un pic favorable atteint via un autre marché ne déclenche pas
  le trailing. Comportement conservé (limitation de replay).
- **Equity curve plate** entre les ticks d'une position : l'equity sous-représente les
  mouvements intra-sample des positions non-tickantes. Comportement conservé.
- **Fill simulé** : prix YES ± slippage, clampé à [0,1]. Un clamp émet
  `fill_price_clamped`. PnL = borne indicative, pas une exécution réelle.
- **Résolution** : pas de fallback `entryPrice` (depuis 0.6.0) — seule `tick.yesPrice`
  ou `markPrice`. Les fees de résolution restent 0 (courbe Polymarket nulle aux prix 0/1).
- **Entrée runner-sim (depuis 0.8.0)** : les ticks d’un même poll (~10–20 ms d’écart)
  sont coalescés (`RUNNER_SIM_BATCH_COALESCE_MS = 1000`). `entryAt` = timestamp du
  tick de décision, pas du flush. Un signal n’est pas fillé si le marché est déjà
  résolu, si le prix a divergé de plus de 0.10, ou si le tick courant déclencherait
  le SL immédiatement. Le flush du batch précédent est appelé **avant** les gardes
  duplicate / max concurrent / throttle (`maybeFlushRunnerSimBatch`) ; les signaux
  non retenus sont **droppés** (pas de file) pour ne pas être fillés plus tard sur
  un marché déjà ailleurs. `decidedAt` est re-pairé par identité d’objet signal
  (`pairDecidedAtBySignal`). `fill_price_clamped` n’est émis qu’après la garde SL
  immédiat (entrée réellement ouverte).

> **Résolution per-strategy (depuis 0.5.0)** : `maxExposureUsdc`, `maxDailyLossUsdc`,
> `maxPositionSizeUsdc`, `killSwitchAction` et `maxPositionsPerCityDate` sont résolus
> via `getStrategyParams(cfgSnapshot, strategyId)` pour **chaque position** — pas via
> un bag global. Le bag de `signal.strategyId` est utilisé pour chaque position. Le kill-switch ferme uniquement les
> positions de la stratégie déclenchée (pas toutes les positions du ledger).

---

## 2. Modes de run

| Mode | Comportement | Usage |
|------|--------------|-------|
| `reevaluate` | À chaque `book_tick` : reconstruit le contexte marché + forecast as-of et appelle la stratégie du catalogue (`createWeatherStrategy(strategyId)`) pour décider l'entrée. Pour `weather-highest-yes`, il n'y a **pas** de forecast as-of : l'évaluation repose sur le prix YES courant. | Tester une stratégie sur données passées |
| `replay` | Entre sur chaque décision `signal` déjà enregistrée dans `weather_evaluation_log` (pas de re-stratégie) | Simuler l'exécution des décisions passées |

**Filtre par intervalle (`fidelityMinutes`)** : paramètre **optionnel** transmis au
lancement. En `reevaluate`, seuls les `book_tick` dont `fidelity_minutes` correspond
sont chargés (`data-loader` filtre `t.fidelityMinutes = :fid`). En `replay`, le
filtre est **bloqué** (erreur 400 `replay_fidelity_filter_unsupported`), car
`weather_evaluation_log` (et son snapshot parent) ne portent pas de colonne
`fidelity_minutes` — combiner replay + filtre produirait des signaux denses avec
des ticks filtrés. Sans `fidelityMinutes`, tous les ticks sont chargés
(comportement historique). Le bandeau de couverture (`GET /backtest/data-coverage`)
accepte `?fidelityMinutes=` pour afficher un `totalTicks` cohérent avec le filtre choisi.

Les **sorties** (drift / bucket-exit / pre-close / SL-TP-trailing / kill-switch /
résolution) sont évaluées en mémoire à chaque `book_tick` pour **toutes** les
positions ouvertes (via cache `lastTickByCondition`, pas seulement le
`conditionId` du tick courant). En `reevaluate`, les entrées passent par
`isMarketActiveForWeather` avant l’appel stratégie.

> **Divergence live ↔ backtest (`weather-highest-yes`)** : en **live**, drift
> (`WEATHER_FORECAST_CHANGE`) et bucket-exit (`WEATHER_BUCKET_EXIT`) sont
> **désactivés** pour `weather-highest-yes`. En **backtest**, `evaluateExits`
> (`weather-adapter.ts`) et `exit-manager.ts` opèrent une **garde explicite**
> `isHighestYes` : ces deux sorties ne sont **pas** évaluées pour les positions
> `weather-highest-yes` (aligné sur le live).

---

## 3. Architecture du package

### 3.1 Noyau moteur (`src/engine/`)

| Fichier | Rôle |
|---------|------|
| `virtual-clock.ts` | Horloge virtuelle `now()` / `advanceTo(t)` avec garde anti-retour |
| `events.ts` | Types d'événements `book_tick`, `forecast`, `signal` |
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
| `question-builder.ts` | Synthèse question Polymarket (targets fractionnaires préservés) pour la stratégie |
| `clocked-weather-strategy.ts` | Factory `createWeatherStrategy(strategyId)` + wrapper clock |
| `runner-sim.ts` | Simulation runner live (groupes buckets, dedup, selectionMode) |
| `weather-adapter.ts` | Entrées/sorties, filtre lifecycle, kill-switch, résolution par prix YES |

### 3.3 Point d'entrée (`src/index.ts`)

- `runBacktest(input)` : parse les params, applique `configOverrides` sur le snapshot
  config, charge les événements, construit `WeatherBacktestAdapter`, exécute le runner.
- `parseBacktestParams` / `backtestRunParamsSchema` (validation Zod).

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

Un seul run weather actif **par utilisateur** : `BacktestRunService.hasActiveRun`
détecte un run `running` **ou** `queued` → la route `POST /runs` renvoie `409`.
L'index unique partiel `backtest_run_active_unique(domain, user_id)` est la source
de vérité anti-course (TOCTOU) : deux `POST` simultanés ne peuvent pas insérer deux
runs actifs pour le même utilisateur. Les runs hérités (`user_id IS NULL`) restent
visibles de tous (rétro-compatibilité) et ne se collisionnent pas entre eux
(PostgreSQL traite les NULL comme distincts dans un index unique).

---

## 5. Sorties weather (exits)

Paramètres lus depuis le bag per-strategy
(`getStrategyParams(cfgSnapshot, strategyId)` → `WeatherStrategyParamsBag`).
`strategyId` attaché à chaque position/snapshot ; legacy `null` → fallback
`'weather-forecast'`. En `runner-sim` multi-stratégies, chaque position utilise
**son propre** bag (résolu via `pos.meta.strategyId`), pas un bag global.

| Raison | Déclencheur |
|--------|-------------|
| `WEATHER_FORECAST_CHANGE` | `|currentMean - entryMean| > bag.forecastChangeThreshold` — **pose** le throttle — **non applicable à `weather-highest-yes` en live ni en backtest** |
| `WEATHER_BUCKET_EXIT` | Forecast hors palier + `bag.cityFollowSwitchMode = close_and_reenter` après `bag.bucketHysteresisPolls` avancées espacées de `weatherAlgoPollMs` — **pose** le throttle — **non applicable à `weather-highest-yes` en live ni en backtest** |
| `SL` | Seuil résolu à l'entrée via `resolveWeatherEntryExitParams(risk, mode, interval, strategyId)` (défauts `WEATHER_EXIT_DEFAULTS` si bidPoints null) — **pas** de confirmation ticks — **throttle `reentryThrottleAfterSlMs`** posé (ville+date+stratégie) |
| `TP` / `TRAILING` | Seuils résolus à l'entrée (défauts `WEATHER_EXIT_DEFAULTS`) — **pas** de confirmation ticks, **pas** de throttle |
| `KILL_SWITCH` | `dailyRealizedPnl(strategyId) <= -bag.maxDailyLossUsdc` et `bag.killSwitchAction === 'force_close_all'` — ferme **uniquement** les positions de la stratégie déclenchée (pas toutes les positions du ledger) |
| `RESOLUTION` | Marché résolu par prix YES (`>= 0.99` → YES / `<= 0.01` → NO) — 1 tick suffit |
| `BACKTEST_INCOMPLETE_DATA` | Position encore ouverte en fin de run (aucun tick de résolution reçu) — résolution forcée au dernier `markPrice` (ou `entryPrice` si aucun) |

> **Note** : les runs avec `engineVersion < 0.5.0` ont été produits avant l’alignement
> SL/TP/throttle/filtres/résolution forcée/résolution par prix/garde-fous per-strategy — **non comparables** aux runs ≥ `0.5.0`.
> Les runs `0.6.0` (et inférieurs) incluent des trades runner-sim de durée nulle
> ou de fill stale — **non comparables** aux runs ≥ `0.8.0`.
>
> **Source unique des raisons de sortie** : `packages/core/src/backtest/backtest-exit-reasons.ts`
> (`BACKTEST_EXIT_REASONS` + `EXIT_REASON_LABEL`). Toute nouvelle raison doit y être
> déclarée pour rester cohérente avec le filtre API `?exitReason=` et l'affichage UI.

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
- Sur timeout et cancel, `adapter.finish` est **aussi** appelé (résolution forcée
  des ghost positions `BACKTEST_INCOMPLETE_DATA`), pas uniquement sur `completed`.

---

## 8. UI

Onglet **Backtest** de la page Weather Algo (`WeatherAlgoBacktestTab` +
`BacktestEquityChart`) :

- **Couverture de données** affichée avant lancement.
- **Formulaire** : mode, période, villes, capital, slippage, entrée USDC, positions max
  (pas d'UI pour `configOverrides` — disponibles via API).
- **Liste des runs** : statut, progression, métriques.
- **Détail** : métriques (PnL, win rate, PF avec `∞` si null, expectancy, durée
  moy., répartition par sortie / ville), avertissements de fidélité, message
  d'erreur si `status === failed`. Ligne de capital du chart = `run.params.capital`
  (pas le formulaire). Polling nettoyé au démontage de l’onglet.
- Courbe d'equity + tableau des positions : chargés **uniquement** si
  `status === 'completed'` (un run `cancelled` peut avoir des rows en DB mais
  l'UI ne les fetch pas). Axe X du chart = champ `t` (timestamp ISO des
  `backtest_equity_points`), pas un index.
- **Timeline des marchés parcourus** (`BacktestMarketRidgeChart`, ridge plot) :
  une voie par marché (ville + date cible), courbe du prix YES au fil du temps,
  marqueurs vert/rouge pour les entrées/sorties des positions tradées. Le tooltip
  player (`RidgePlayTooltip`) et le tooltip voie (`RidgeTooltip`) affichent
  `Position #{id}` ; `fmtHolding` formate les holds `< 1 min` en `ms` / `s`
  (plus « 0 min »). Les markers sont placés à `(entryAt, entryPrice)` — le fill
  inclut le slippage, donc le point vert peut s’écarter légèrement de la courbe
  YES brute. Données dérivées de `weather_bucket_ticks` via
  `GET /runs/:id/markets-series` (même filtre `fidelityMinutes` que le moteur) —
  chargées **uniquement** si `status === 'completed'` et que
  `dataRangeFrom`/`dataRangeTo` sont renseignés.

---

## 9. Tests

- `src/engine/stats.test.ts` : Ledger, `computeStats`, `computeMaxDrawdown`.
- `src/engine/exit-manager.test.ts` : défauts SL/TP, throttle restreint, hystérésis `pollMs`.
- `src/engine/merge-event-streams.test.ts` : merge k-way, régression heap init
  (stream 0 plus tardif que stream 1).
- `src/adapters/weather/weather-adapter.test.ts` : run replay (entrée + résolution),
  meta persisté, limite positions, capacité ville+date replay, résolution fallback,
  metric non supporté, hors plage, résolution forcée ghost positions, carry-forward markPrice,
  garde highest-yes drift/bucket, **garde-fous per-strategy** (`ledger.openExposure` /
  `dailyRealizedPnl` filtrage par `strategyId`, `maxExposureUsdc` par stratégie bloque
  2e entrée, `maxExposureUsdc` généreux autorise multiple entrées), **warning
  `multi_position_stale_mark` agrégé**, **clamping prix [0,1]**, **entrée runner-sim
  0.8.0** (`entryAt` = décision, coalesce 1 s, skip marché résolu / prix stale /
  SL immédiat, flush avant gardes + drop sans file, `pairDecidedAtBySignal` ;
  tests F4 throttle + F5 pairing).
- `src/adapters/weather/question-builder.test.ts` (nouveau) : cibles fractionnaires
  préservées et re-parsées, bornes between négatives fractionnaires, entiers sans `.0`.
- `src/engine/fill-engine.test.ts` (nouveau) : slippage entrée/sortie, plafond `maxPositionSizeUsdc`,
  clamping prix [0,1] avec fees=0 aux extrêmes, courbe de fees exponentielle.
- `src/engine/runner.test.ts` (nouveau) : abort coopératif — `cancelled` et `timeout` mid-stream
  (statut persisté + equity conservée), run vide, progression 100% à completion.
- `src/adapters/weather/data-loader.test.ts` (nouveau) : pagination keyset ordonnée
  `(recordedAt, id)`, filtre villes, comptage `countWeatherEvents`.
- `src/adapters/weather/golden-replay.test.ts` (nouveau) : **golden snapshot** — rejoue un scénario
  figé et fige `totalPnl`, `winRate`, `maxDrawdown`, `totalTrades`, `byExitReason` et
  `engineVersion`. Toute régression de sémantique de replay fait échouer le test
  (régénération : `vitest run -u`).
- `packages/core/src/services/backtest-run.service.test.ts` : verrou singleton (par utilisateur),
  **isolation multi-utilisateur** (`getById`/`list` filtrent par owner, runs hérités `userId=NULL`
  visibles par tous), delete en cascade positions/equity/excluded.

Lancement : `npm run test -w @polywatch/backtest`.

### 9.1 Sémantique des statistiques (`stats.ts`)

- **`maxDrawdown`** : relatif au peak (`(peak - equity) / peak`) **uniquement si `peak > 0`**.
  Si l'equity passe négative (`peak <= 0`), le drawdown relatif n'est **pas** mesuré (gardé à la
  dernière valeur positive) pour éviter une division par zéro. Comportement documenté, pas de bug.
- **`profitFactor`** : `null` quand il n'y a **aucune** position perdante (grossLoss = 0) — encode
  `+Infinity` de façon JSON-safe. `0` quand aucun trade. Les trades breakeven (`pnl === 0`) ne sont
  ni wins ni losses (exclus de `avgLoss` et `grossLoss`).
- **`avgLoss`** : valeur **négative** (moyenne des pertes), cohérent avec `avgWin` positif.
- **`byExitReason` / `byCity`** : décomptes bruts de trades fermés.

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

## 11. Hors scope v1

- Adaptateurs **crypto** et **copy trading** (plan d'origine).
- Prometheus (`polywatch_backtest_*`), Socket.IO (`backtest:*`).
- Comparaison A/B de runs, export CSV, grid-search / optimisation.

Plan d'origine : [`plans/2026-08-05_PLAN-backtest-engine-universel.md`](../plans/2026-08-05_PLAN-backtest-engine-universel.md).
