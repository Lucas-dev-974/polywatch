# Plan d'implémentation — moteur de backtest universel (crypto-algo, copy trading, weather-algo)

**Date** : 2026-08-05 (rev. 1)
**Sources** : inventaire données/moteurs/UI du codebase v1.1 + `docs/plans/2026-08-05_PLAN-strategies-crypto-algo-5min.md` (Phase 5.1)
**Objectif** : un **vrai moteur de backtest historique** (replay event-driven sur les données persistées), **générique** sur les 3 domaines, **réutilisant la logique métier live** (stratégies, gates, exits, sizing, fills sim), pilotable depuis l'UI : **configuration** d'un run, **exécution** asynchrone suivie en temps réel, **résultats** détaillés (métriques, equity curve, trades), **métriques Prometheus** d'exploitation.

---

## 0. Principes directeurs

1. **Zéro réécriture métier** — le moteur réutilise `CryptoAlgoStrategy.evaluate`, `WeatherForecastStrategy.evaluate`, les gates copy, `evaluatePositionExit` / `evaluateSlTpTrailing`, `computeEntryTargetQuantity`, `simulateFakFill`, `computeTakerFee`, `replaySimCashDelta`. Toute divergence moteur/live est un bug.
2. **Nouveau package `packages/backtest`** — aucun impact sur les processus live ; le live ne dépend jamais du backtest.
3. **Event-driven + horloge virtuelle** — les événements (ticks, moves, forecasts) sont rejoués triés par timestamp ; aucune date système, aucun `setInterval`, aucune WS dans le chemin de replay.
4. **Fidélité explicite** — chaque approximation (profondeur de book absente, mid seul, délai de détection) est documentée, paramétrable, et affichée dans l'UI du run. Mode **conservateur par défaut**.
5. **Données d'abord** — Phase 0 sécurise la collecte (rétention, strike/spot, historique forecasts) avant de construire le moteur ; l'UI expose la **couverture de données** avant le lancement.
6. **Un domaine à la fois, crypto d'abord** (données les plus riches : BBO 1 Hz).
7. **Run = job async** selon le pattern existant E2E/monitor (HTTP 202 + Socket.IO + recover GET), jamais de requête synchrone bloquante.
8. **Reproductibilité** — chaque run fige : params, snapshot config stratégie, version moteur, plage de données.

---

## 1. Inventaire des données & fidélité par domaine

### 1.1 Crypto-algo

| Donnée | Table | Granularité | Rétention actuelle | Usage backtest |
|---|---|---|---|---|
| Ticks BBO+VWAP+tailles+Δ1s+`seconds_until_end`+signal | `algo_price_ticks` (`AlgoPriceTick.ts`) | **1 Hz** / conditionId | **24 h** (purge activée, `cryptoAlgoTickRetentionHours`) | **Source principale** — reconstitue `TopOfBookData` up/down + `midHistory` |
| Fenêtres marchés (symbol, interval, start/end, `winning_outcome`) | `algo_surveillance_snapshots` | par fenêtre 5m/15m | conservé | Métadonnées + **payout redemption** |
| Marchés trackés | `algo_market_selections`, `algo_auto_track_rules` | — | 7 j après disable | Univers à rejouer |
| Positions/exécutions/sim archives | `copied_positions`, `executions`, `exit_attempt_events`, `sim_archive_*` (+ bougies 1 min) | — | conservé | Validation moteur vs live (Phase 7) |
| **Strike K / spot oracle** | — | — | **non persisté** | Manquant → Phase 0.2 (stratégies S1/S2 uniquement ; S9/S3/naive s'en passent) |
| **Order book depth (L2)** | — | — | jamais persisté (RAM WS) | Limite fill model → §8 |

**Verdict** : backtest **fidèle** pour naive-momentum / S9 / S3 (BBO 1 Hz suffit), à condition d'allonger la rétention (Phase 0.1).

### 1.2 Copy trading

| Donnée | Table | Granularité | Rétention | Usage backtest |
|---|---|---|---|---|
| Deltas positions whales (OPENED/INCREASED/DECREASED/CLOSED, `trader_avg_price`, `detected_at`) | `move_events` | par event (poll ~2 s) | pas de TTL | **Source principale** — flux de signaux à rejouer |
| BBO par position ouverte | `market_position_ticks` | ~500 ms | **30 j** | Prix d'entrée/sortie précis quand dispo |
| Historique prix CLOB (`/prices-history`) | `market_price_ticks` (+ curseur `market_price_history_sync`) | **mid seul**, fidélité ~60 min | pas de purge (défaut 0) | Fallback prix hors position |
| Positions/exécutions copiées | `copied_positions`, `executions` | — | conservé | Validation |
| Historique complet traders | — (`trader_snapshots` = état courant, upsert destructif) | — | — | Non requis : `move_events` suffit à rejouer les **signaux** |
| Book depth | — | — | — | Limite fill model → §8 |

**Verdict** : backtest **correct** sur l'univers des marchés où des moves ont été détectés (prix mid horaire en fallback → slippage buffer obligatoire).

### 1.3 Weather-algo

| Donnée | Table | Granularité | Rétention | Usage backtest |
|---|---|---|---|---|
| Forecast cache (mean, std, model_values) | `weather_forecast_cache` | par (city, date, metric) | **upsert — pas d'historique de révisions** | Insuffisant aujourd'hui → Phase 0.3 |
| Snapshot forecast à l'entrée | `weather_position_forecasts` | 1/position | conservé | Validation |
| Positions weather | `copied_positions` (`WEATHER_*`) | — | conservé | Univers + validation |
| Prix marchés | `market_price_ticks` / `market_position_ticks` | mid horaire / 500 ms si position | cf. §1.2 | Entrées/sorties |
| Observations réalisées | — | — | **non collecté** | Résolution via `markets`/`winning_outcome` si dispo, sinon hors scope v1 |

**Verdict** : backtest **exploitable seulement après accumulation** d'historique de forecasts versionnés (Phase 0.3). Le moteur est livré domaine weather inclus, mais la profondeur historique dépend de la collecte.

### 1.4 Limites assumées (zones d'ombre levées d'office)

| Limite | Impact | Traitement |
|---|---|---|
| Pas de book L2 historique | Fill size réaliste inconnu | Fill model top-of-book + cap taille + buffer slippage paramétrable (§8) |
| `market_price_ticks` = mid horaire | Prix d'entrée copy/weather approximatif hors position | Mode conservateur : mid × (1 + `slippageBps`) à l'achat |
| Spot/strike non persisté | S1/S2 non rejouables rétroactivement | Phase 0.2 ; backtest S1/S2 possible **à partir de** la mise en prod de la collecte |
| Forecasts non versionnés | Weather non rejouable rétroactivement | Phase 0.3 ; idem prospectif |
| Rétention ticks crypto 24 h | Historique court | Phase 0.1 : rétention ↑ + export archive |

---

## 2. Architecture cible

```
┌──────────────────────── packages/backtest ────────────────────────┐
│                                                                    │
│  DataLoaders (SQL)        VirtualClock      EventBus (min-heap t)  │
│  ├─ crypto ticks            (t courant)      ├─ BookTickEvent      │
│  ├─ move events                                ├─ MoveEvent        │
│  ├─ forecast history                           ├─ ForecastEvent    │
│  └─ market metadata                            └─ WindowCloseEvent │
│         │                                            │             │
│         ▼                                            ▼             │
│  ┌─ DomainAdapters ────────────────────────────────────────┐       │
│  │ crypto : ticks → StrategyContext → strategy.evaluate    │       │
│  │ weather : forecast → WeatherEvaluationContext → evaluate│       │
│  │ copy : move → copy-risk-gate → sizing                   │       │
│  └─────────────────────────────────────────────────────────┘       │
│         │ signals                                                  │
│         ▼                                                          │
│  Sizing (core entry-sizing) → FillEngine (core simulateFakFill     │
│  sur book reconstitué + fees) → Exits (core evaluatePositionExit   │
│  + weather exit rules + whale exits) → Ledger (positions, cash,    │
│  equity, accounting core)                                          │
│         │                                                          │
│         ▼                                                          │
│  StatsComputer (WR, PF, maxDD, …) → RunRepository (DB)             │
└────────────────────────────────────────────────────────────────────┘
         │ spawn/job async (backend)          ▲ réutilisation directe
         ▼                                    │ des packages core /
   API /api/backtest/*  ── Socket.IO ── UI    │ crypto-algo / weather-algo
```

### 2.1 Composants réutilisés tels quels (chemins exacts)

| Fonction | Fichier |
|---|---|
| Interface stratégie crypto + `StrategyContext` | `packages/crypto-algo/src/strategy/strategy.ts` (L72–94) |
| `NaiveMomentumStrategy` | `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts` |
| `StrategyRegistry` crypto | `packages/crypto-algo/src/strategy/registry.ts` |
| `MidHistoryBuffer` (alimenté par les ticks rejoués) | `packages/crypto-algo/src/mid-history-buffer.ts` |
| Résolution config crypto | `packages/core/src/risk/crypto-algo-tunables.ts` (`resolveNaiveMomentumConfig` L200–241) |
| Gates + pipelines copy | `packages/copy-trading/src/processors/copy/copy-risk-gate.ts`, `copy-entry-pipeline.ts`, `copy-exit-pipeline.ts` |
| Stratégie + exits weather | `packages/weather-algo/src/strategy/weather-forecast.strategy.ts`, `processors/weather-exit-evaluator.ts` |
| Edge/parse weather | core `computeMarketImpliedProbabilities`, `calculateEdge`, `parseWeatherQuestion` |
| Décision de sortie SL/TP/trailing | `packages/core/src/risk/exit-decision.ts` (L70–82), `packages/core/src/risk/policy.ts` (`evaluateSlTpTrailing` L360+) |
| Sizing | `packages/core/src/sizing/entry-sizing.ts` (`computeEntryTargetQuantity` L56–117) |
| Fill math | `packages/core/src/pricing/vwap.ts` (`simulateFakFill` L75–104), `computeTakerFee` |
| Accounting | `packages/core/src/simulation/accounting.ts` (`replaySimCashDelta`), `algo-kind.ts` |

### 2.2 Ce qui est abstrait (ports backtest)

| Couplage live | Remplacement backtest |
|---|---|
| `Date.now()` / `new Date()` dans runners, exits, `minTimeToClose` | `VirtualClock.now()` injectée (les fonctions core prennent déjà un `now` en paramètre ou sont wrappées) |
| WS price-feed / `safeInterval` / poll 100 ms worker | `EventBus` émettant `BookTickEvent` au rythme des ticks persistés |
| `PolymarketConnectionManager.fetchExecutablePrices` | Book reconstitué depuis le tick courant (BBO + VWAP ref + tailles) |
| Data API (positions whales), Open-Meteo live, Gamma fallback | DataLoaders SQL (aucun appel réseau pendant un run) |
| Redis queues (`enqueueEntrySignal`, réservations, dedupe) | Appel direct in-process au pipeline de décision (pas de queue en replay) |
| Sleep latence `simulateFill` | Latence virtuelle ajoutée au timestamp de fill (paramètre), pas de sleep réel |
| Persistance positions live (`copied_positions`) | `Ledger` mémoire → flush vers tables backtest dédiées |

**Refactor préalable minimal (Phase 1.2)** : les fonctions core ci-dessus sont pures ou quasi pures ; le seul refactor attendu est d'exposer des variantes acceptant `now` injecté là où `Date.now()` est enfoui (exit-decision, weather hours-before-close). **Aucun changement de comportement live.**

---

## 3. Modèle de données backtest (nouvelles tables)

> Table dédiée (et non `analysis_reports`) : un run est un **job** (status, progression, erreur, cancel) — `analysis_reports` n'a ni status ni progression et sa rétention 50/90 j purgerait les runs.

### 3.1 `backtest_runs`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | serial PK | |
| `created_at` / `started_at` / `finished_at` | timestamptz | cycle de vie |
| `status` | text | `queued` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `progress_pct` | int | avancement (événements traités / total) |
| `domain` | text | `crypto` \| `weather` \| `copy` |
| `label` / `note` | text | UI |
| `params_json` | text | `{ from, to, symbols?, strategies[], configOverrides?, fillModel, capital, slippageBps, detectionDelayMs, … }` |
| `config_snapshot_json` | text | config stratégie figée au lancement (CryptoConfig/WeatherConfig/CopyConfig résolue) |
| `data_range_from` / `data_range_to` | timestamptz | plage réellement couverte par les données |
| `stats_json` | text | métriques agrégées (§10.2) — null tant que running |
| `fidelity_warnings_json` | text | avertissements affichés en UI (ex. « 32 % des fills au mid horaire ») |
| `engine_version` | text | semver du package backtest — reproductibilité |
| `config_fingerprint` | text | détection de divergence entre runs |
| `error` | text nullable | stack/message si failed |

Index : `(domain, created_at)`, `(status)`.

### 3.2 `backtest_positions`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | serial PK | |
| `run_id` | int FK → `backtest_runs` (ON DELETE CASCADE) | |
| `condition_id` / `symbol` / `side` | text | marché + UP/DOWN ou YES/NO |
| `qty` / `entry_price` / `exit_price` | numeric | |
| `entry_at` / `exit_at` | timestamptz | |
| `entry_reason` / `exit_reason` | text | `ALGO_OPEN`… / `SL`, `TP`, `TRAILING`, `REDEMPTION`, `WINDOW_CLOSE`, `COPY_CLOSE`, `WEATHER_*` |
| `pnl` / `fees` | numeric | |
| `meta_json` | text | signal detail, forecast snapshot, move id, fill mode (`bbo`/`mid_fallback`) |

Index : `(run_id)`, `(run_id, exit_reason)`.

### 3.3 `backtest_equity_points`

| Colonne | Type | Rôle |
|---|---|---|
| `run_id` | int FK CASCADE | |
| `t` | timestamptz | |
| `equity` / `cash` | numeric | equity = cash + mark-to-market des positions ouvertes |
| `open_positions` | int | |

Échantillonnage : **1 point / minute max** (cap ~50 k points/run) — suffisant pour `TimeSeriesLineChart`.

### 3.4 Rétention

Pas de purge automatique v1 ; `DELETE /api/backtest/runs/:id` manuel. (Réévaluer si volume > 500 runs.)

---

## 4. Phase 0 — Fondations données (~2–3 j)

> Sans elle, le moteur n'a rien à rejouer au-delà de 24 h. **Bloquant pour tout le reste.**

- [ ] **0.1** Rétention ticks crypto : passer `cryptoAlgoTickRetentionHours` de 24 → **720 (30 j)** en défaut de config + vérifier volumétrie (1 Hz × ~N fenêtres ≈ 86 k lignes/jour/marché ; estimer taille DB et ajuster). Exporter vers `sim_archive_price_candles` (bougies 1 min, existe déjà — `packages/core/src/simulation/archive-price-candles.ts`) **avant** purge pour conserver un historique long terme dégradé.
- [ ] **0.2** Persister **strike K + spot à l'open** par fenêtre crypto : nouvelles colonnes sur `algo_surveillance_snapshots` (`strike_k`, `spot_open`, `spot_source`) alimentées par le data stream RTDS du plan crypto Phase 3.A (ou CoinGecko en attendant). **Dépendance croisée** : `2026-08-05_PLAN-strategies-crypto-algo-5min.md` §3.A.6 — mutualiser l'implémentation.
- [ ] **0.3** Weather : nouvelle table `weather_forecast_history` **append-only** (`city`, `forecast_date`, `metric`, `forecast_mean`, `forecast_std_dev`, `model_values_json`, `fetched_at`) écrite à chaque refresh de `WeatherForecastService.getOrFetch` (`packages/core/src/services/weather-forecast.service.ts` L29–80). Le cache upsert existant reste inchangé.
- [ ] **0.4** Copy : rien à changer — `move_events` est déjà append-only. Vérifier seulement que `market_price_ticks` reste sans purge (défaut 0) et que le bootstrap `MarketPriceHistorySyncer` couvre les marchés à move détecté (aujourd'hui bootstrap à l'ouverture de position → étendre le bootstrap à la **détection d'un move**, sinon le prix mid historique du marché manque avant la première position).
- [ ] **0.5** Endpoint couverture : `GET /api/backtest/data-coverage?domain=` → par domaine : `from`, `to`, `events_count`, détail par symbole/marché. **Critère d'acceptation UI** : le formulaire de run affiche cette couverture et **refuse** un run hors plage.

**Critère de phase** : `algo_price_ticks` conservé 30 j, forecasts versionnés en écriture, strike/spot persistés (ou plan daté), data-coverage répondant pour les 3 domaines.

---

## 5. Phase 1 — Noyau moteur `packages/backtest` (~3–4 j)

### 5.1 Création package

- [ ] **5.1.1** `packages/backtest/` (tsconfig, package.json `private`, deps : `@polywatch/core` + packages domaines en peer). Point d'entrée `src/index.ts` exportant `runBacktest(spec): Promise<RunResult>`.
- [ ] **5.1.2** `engine_version` = version du package, incrémentée à chaque changement de logique de replay.

### 5.2 Primitives

- [ ] **5.2.1** `VirtualClock` (`src/engine/virtual-clock.ts`) : `now(): Date`, `advanceTo(t)`, garde anti-retour (throw si régression > 1 tick — détecte les données mal triées).
- [ ] **5.2.2** `EventBus` (`src/engine/event-bus.ts`) : min-heap par timestamp ; types :
  ```ts
  type BacktestEvent =
    | { kind: 'book_tick'; at: Date; conditionId: string; tick: ReconstructedTick }
    | { kind: 'move'; at: Date; move: MoveEventRow }
    | { kind: 'forecast'; at: Date; forecast: ForecastRevision }
    | { kind: 'window_close'; at: Date; conditionId: string; winningOutcome?: string }
    | { kind: 'timer'; at: Date; tag: string }; // ex. boucle exits 1 s crypto
  ```
- [ ] **5.2.3** `ReconstructedTick` : mapping strict colonnes `algo_price_ticks` → `TopOfBookData` up/down + `MidHistorySample` (champs : bid/ask/size, VWAP ref, last trade, `seconds_until_end`, `ws_healthy` → ignoré en replay).
- [ ] **5.2.4** `Ledger` (`src/engine/ledger.ts`) : positions ouvertes en mémoire, cash par `algoKind` (réutilise `algoKindFromReason`), mark-to-market au dernier tick, `recordFill`, `closePosition`, `equityAt(t)` ; flush batch → `backtest_positions` / `backtest_equity_points` (buffer 1 000 lignes, `INSERT` multi-lignes).
- [ ] **5.2.5** `FillEngine` (`src/engine/fill-engine.ts`) — cf. §8.
- [ ] **5.2.6** `StatsComputer` (`src/engine/stats.ts`) — cf. §10.2.
- [ ] **5.2.7** `RunContext` : `{ runId, clock, ledger, fillModel, params, configSnapshot, fidelityWarnings[] }` passé à tous les adaptateurs.

### 5.3 Refactor core minimal

- [ ] **5.3.1** Audit des `Date.now()` dans `packages/core/src/risk/exit-decision.ts`, `policy.ts`, weather exit evaluator : ajouter paramètre `now` optionnel (défaut `Date.now()` → live inchangé).
- [ ] **5.3.2** Extraire de `weather-exit-evaluator.ts` la logique pure (`shouldCloseForForecastDrift`, bucket, pre-close) si couplée à Redis (hysteresis) : variante avec hysteresis en mémoire dans `RunContext`.
- [ ] **5.3.3** Tests unitaires : equivalence fonction avec/sans `now` injecté.

### 5.4 Runner

- [ ] **5.4.1** `BacktestRunner` (`src/engine/runner.ts`) : charge événements (stream SQL par curseur, pas de `SELECT *` en mémoire), alimente le bus, boucle `while (event = bus.next()) { clock.advanceTo(event.at); adapter.handle(event); exits.check(event); ledger.markToMarket(event); }`, yields `await setImmediate()` toutes les 5 000 événements (ne pas bloquer l'event loop backend), émet progression (toutes les ~2 s de traitement), supporte `cancel()` (flag coopératif vérifié à chaque yield).
- [ ] **5.4.2** Garantie de déterminisme : même params + même données + même `engine_version` ⇒ mêmes positions (test Phase 7).

---

## 6. Phase 2 — Adaptateur crypto-algo (~3–4 j)

> Premier domaine — données les plus riches (BBO 1 Hz + redemption connue).

- [ ] **6.1** `CryptoDataLoader` (`src/adapters/crypto/data-loader.ts`) :
  - Univers : `algo_market_selections` ∩ période, enrichi `algo_surveillance_snapshots` (`crypto_symbol`, `interval`, `market_start_at`, `market_end_at`, `winning_outcome`, `strike_k` si Phase 0.2 déployée).
  - Stream `algo_price_ticks` par `condition_id` trié `recorded_at`.
  - Émet `book_tick` par ligne + `window_close` à `market_end_at` (avec `winning_outcome`).
  - Fallback bougies `sim_archive_price_candles` (1 min) si ticks absents sur une fenêtre → `fidelityWarnings += 'candle_fallback'`.
- [ ] **6.2** `CryptoAdapter` (`src/adapters/crypto/adapter.ts`) :
  - Sur `book_tick` : alimente `MidHistoryBuffer`, construit `StrategyContext { books, midHistory, now: clock.now() }`, appelle `strategy.evaluate(market, ctx)` pour chaque stratégie active du run (registry réutilisé, `cryptoAlgoStrategies` du config snapshot).
  - Signal → sizing (`computeEntryTargetQuantity` avec balances du Ledger) → `FillEngine.buy/sell` → Ledger ouvre position avec seuils (`slBidPoints`, `tpBidPoints`, `trailingBidPoints` issus du config snapshot, **pas** re-lus en live).
- [ ] **6.3** Exits : à chaque `book_tick` touchant une position ouverte (équivalent boucle 100 ms live, cadence 1 s en replay = granularité ticks) → `evaluatePositionExit` (core, `now` injecté) avec `mark_bid` du tick → close via FillEngine (vente au bid, conservateur : `bid × (1 − slippageBps)`).
- [ ] **6.4** Redemption : sur `window_close`, position encore ouverte → payout `qty × (side == winningOutcome ? 1 : 0)`, `exit_reason = 'REDEMPTION'` ; si `winning_outcome` inconnu → close au dernier mid, `exit_reason = 'WINDOW_CLOSE'` + warning.
- [ ] **6.5** Règles temporelles : `minTimeToClose` et veto `T_left` évalués avec `seconds_until_end` du tick (déjà persisté — pas de calcul de date).
- [ ] **6.6** Tests : replay d'une fenêtre synthétique (fixture 300 ticks) → signal/entrée/SL/redemption déterministes.

**Critère** : sur les 24–72 dernières heures de ticks réels, le run produit positions + equity + stats, 100 % des fills en mode `bbo`, zéro appel réseau (testé en coupant le réseau/mock).

---

## 7. Phase 3 — Adaptateur weather-algo (~2–3 j)

- [ ] **7.1** `WeatherDataLoader` : stream `weather_forecast_history` (Phase 0.3) → `forecast` events ; univers marchés = `markets` de type weather ∩ villes `weather_auto_track_rules` ∩ période ; prix via cascade §1.2 (`market_position_ticks` → `market_price_ticks` mid horaire) → `book_tick` synthétique (bid=ask=mid × (1 ∓ slippageBps)).
- [ ] **7.2** `WeatherAdapter` : sur `forecast` → `WeatherEvaluationContext` reconstruit (forecast courant + marchés + prix courants) → `WeatherForecastStrategy.evaluate` → edge → signal ; sur `book_tick` → exits weather (forecast drift vs snapshot d'entrée stocké dans `meta_json`, bucket exit avec hysteresis en mémoire, pre-close via `now` injecté).
- [ ] **7.3** Résolution : à `end_date` du marché, payout selon `winning_outcome` si renseigné, sinon close au dernier mid + warning `resolution_unknown`.
- [ ] **7.4** Warnings fidélité obligatoires : `% fills mid horaire`, `forecast revisions < N/jour`.

**Critère** : run weather de bout en bout sur données Phase 0.3 (même courtes), warnings affichés, déterminisme.

---

## 8. Phase 4 — Adaptateur copy trading (~2–3 j) + FillEngine unifié

### FillEngine (livré ici, utilisé dès la Phase 6 — spécifié une seule fois)

- [ ] **8.1** Modèles de fill (`fillModel` paramètre run) :
  | Modèle | Règle BUY | Règle SELL | Usage |
  |---|---|---|---|
  | `bbo_conservative` *(défaut)* | `ask_vwap × (1 + slippageBps)`, qty cappée à `top_ask_size × maxBookParticipation` (défaut 50 %) | `bid × (1 − slippageBps)` | crypto (ticks riches) |
  | `bbo_optimistic` | `ask`, qty ≤ top size | `bid` | borne haute |
  | `mid_buffered` | `mid × (1 + slippageBps)` | `mid × (1 − slippageBps)` | fallback mid horaire (copy/weather) |
  - Slippage restant non rempli (qty > size dispo) → **fill partiel** enregistré (`meta_json.partial: true`) + warning si taux > 5 %.
  - Fees : `computeTakerFee` core, identique au live.

### Adaptateur copy

- [ ] **8.2** `CopyDataLoader` : stream `move_events` triés `detected_at` (filtre watchlist/période) ; prix par marché : cascade `market_position_ticks` (±2 s autour de l'event) → `market_price_ticks` (mid horaire le plus proche, écart max paramétrable, défaut 90 min) → `trader_avg_price` du move (dernier recours, warning `price_from_trade`).
- [ ] **8.3** `CopyAdapter` : sur `move` OPENED/INCREASED → rejoue `copy-risk-gate` (watchlist, toggles, tags, max positions, daily loss — état du Ledger, pas du live) + sizing copy (`getCopySizingParams`) → fill à `prix(event_at + detectionDelayMs)` (délai paramètre, défaut 0 : `detected_at` est déjà le temps de détection live).
- [ ] **8.4** Exits : DECREASED/CLOSED → close au prix courant ; SL/TP génériques via `evaluatePositionExit` si configurés sur la position ; sinon portage jusqu'à résolution (`winning_outcome`) ou fin de période (mark-to-market, `exit_reason = 'END_OF_DATA'`).
- [ ] **8.5** Warnings : `% prix mid horaire`, `% prix depuis trader_avg_price`, moves sans prix trouvé (skippés, comptés).

**Critère** : rejouer la semaine écoulée de `move_events` reproduit un ensemble de positions cohérent avec `copied_positions` live (comparaison Phase 7.2).

---

## 9. Phase 5 — API, exécution async, Prometheus (~2 j)

### 9.1 Routes (`packages/backend/src/routes/backtest.ts`, mount `/api/backtest`, `jwtLimiter`, `requireJwt` par handler, Zod, erreurs `{ error: code }`)

| Méthode | Path | Réponse | Rôle |
|---|---|---|---|
| `GET` | `/data-coverage?domain=` | `{ from, to, eventsCount, bySymbol[] }` | Couverture (Phase 0.5) |
| `POST` | `/runs` | **202** `{ runId }` | Lance un run (body Zod : domain, from/to, strategies, capital, fillModel, slippageBps, configOverrides, label/note). **409 `run_in_progress`** si un run actif (verrou singleton v1) |
| `GET` | `/runs?domain=&limit=&offset=` | `{ items, total }` | Liste |
| `GET` | `/runs/:id` | détail + `stats_json` + warnings | Détail |
| `GET` | `/runs/:id/positions?limit=&offset=` | paginé | Trades |
| `GET` | `/runs/:id/equity` | `Point[]` | Courbe |
| `POST` | `/runs/:id/cancel` | 202 | Cancel coopératif |
| `DELETE` | `/runs/:id` | 204 | Suppression (refusée si running) |
| `GET` | `/runs/compare?a=&b=` | Δ stats + Δ params | Comparaison A/B (calque `compare-reports.ts`) |

### 9.2 Exécution

- [ ] **9.2.1** Pattern audit/monitor existant (`packages/backend/src/system-audit*` / crypto-algo-monitor) : run exécuté **in-process** en async (yields `setImmediate`), verrou singleton, recover après reload via `GET /runs?status=running` (un run `running` orphelin après redémarrage backend → marqué `failed` `error: 'backend_restart'` au boot).
- [ ] **9.2.2** Socket.IO (`packages/backend/src/websocket.ts` + `packages/frontend/src/socket.ts`) : événements globaux `backtest:started`, `backtest:progress` (`{ runId, pct, eventsProcessed }`), `backtest:finished` (`{ runId, status, stats }`) — calque exact des événements `system:audit:*`.
- [ ] **9.2.3** `BacktestRunService` dans `packages/core/src/services/backtest-run.service.ts` (CRUD + transitions de statut) + entités `BacktestRun`, `BacktestPosition`, `BacktestEquityPoint` dans `packages/core/src/entities/`.

### 9.3 Prometheus (`packages/backend/src/metrics.ts`)

- [ ] **9.3.1** `polywatch_backtest_runs_total{domain,status}` (counter), `polywatch_backtest_run_duration_seconds{domain}` (histogram), `polywatch_backtest_events_processed_total{domain}` (counter), `polywatch_backtest_last_run_timestamp{domain}` (gauge).
- [ ] **9.3.2** Cartes Métriques existante (`MetricsDashboardPage`) : ajouter section « Backtests » (runs/24 h, durée moyenne, dernier statut).
- [ ] **9.3.3** Clarification doc : Prometheus = **exploitation** du moteur ; les métriques **métier d'un run** (WR, PF…) vivent dans `stats_json` + UI, pas dans Prometheus.

---

## 10. Phase 6 — UI (~3–4 j)

> Nouvel onglet Système **`backtests`** (à côté de Rapports/Snapshots) — pas de nouvelle page top-level.

### 10.1 Fichiers

| Fichier | Rôle |
|---|---|
| `packages/frontend/src/lib/ui-persistence.ts` | ajouter `'backtests'` à `SystemPageTab` + `SYSTEM_PAGE_TABS` |
| `packages/frontend/src/components/SystemPage.tsx` | `TAB_LABELS['backtests'] = 'Backtests'` + `<Show>` |
| `packages/frontend/src/components/backtests/BacktestsPage.tsx` | conteneur 3 sous-vues : **Nouveau run** / **Historique** / **Détail** |
| `.../backtests/BacktestRunForm.tsx` | configuration (cf. §10.2) |
| `.../backtests/BacktestRunList.tsx` | table runs : statut (badge), domaine, période, PF/WR, durée, actions (voir, comparer, cancel, supprimer) |
| `.../backtests/BacktestRunDetail.tsx` | résultats (cf. §10.3) |
| `.../backtests/BacktestComparePanel.tsx` | Δ A/B (calque `AnalysisReportComparePanel`) |
| `.../backtests/BacktestEquityChart.tsx` | `TimeSeriesLineChart` existant + `Point[]` (aucune nouvelle lib) |
| `packages/frontend/src/lib/backtest.ts` | client API typé |
| `packages/frontend/src/socket.ts` | subs `onBacktestProgress/Finished` |
| `packages/frontend/src/hooks/useBacktestRuns.ts` | polling liste léger (10 s) + socket pour le run actif |

### 10.2 Formulaire « Nouveau run » (configuration)

- **Domaine** (radio cards : Crypto-Algo / Weather-Algo / Copy Trading).
- **Couverture données** affichée en bandeau (via `data-coverage`) : « Données disponibles du 06/07 au 05/08 — 2,1 M ticks, 312 fenêtres » ; dates invalides → bouton désactivé + message.
- **Période** `from`/`to` (bornée à la couverture).
- **Univers** : multi-select symboles/villes/traders (défaut : tous).
- **Stratégies** : checklist (crypto : `naive-momentum` + futures S9/S3/S1/S2 ; une seule active si le plan crypto l'exige).
- **Config** : toggle « config live actuelle » (défaut, snapshotée au lancement) **ou** overrides JSON par clé (mêmes clés que les tunables existants, validation Zod côté API).
- **Exécution** : `fillModel` (défaut `bbo_conservative`), `slippageBps` (défaut 50), `detectionDelayMs` (copy, défaut 0), capital initial (défaut : balance sim du domaine).
- Lancement → 202 → toast + switch auto sur la vue Détail avec **barre de progression live** (socket) et bouton **Annuler**.

### 10.3 Vue « Détail run » (résultats)

- **Header** : statut, domaine, période réelle couverte, durée de calcul, `engine_version`, fingerprint config.
- **Cartes métriques** (`stats_json`) :
  - Rendement : PnL total, PnL %, equity finale, **max drawdown**, exposition moyenne
  - Efficience : **win rate**, **profit factor**, avg win / avg loss, expectancy/trade
  - Activité : nb trades, nb jours couverts, trades/jour, durée moyenne de détention
  - Décomposition : par `exit_reason` (SL/TP/trailing/redemption…), par symbole/ville/trader
- **Equity curve** + courbe de drawdown (`TimeSeriesLineChart`).
- **Table des trades** (paginée, triable, filtre par exit_reason/symbole) : entrée/sortie, qty, prix, PnL, fees, fill mode.
- **Bandeau fidélité** : `fidelity_warnings` (ex. « 18 % des fills au mid horaire — interpréter le PnL avec prudence »).
- **Params & config** utilisés (collapsible JSON, diff vs config live actuelle).
- Actions : comparer avec un autre run, relancer avec mêmes params, supprimer, export CSV des trades.

**Critère UI** : run lancé, progression visible en live, résultats complets affichés < 2 s après `finished`, tout rechargé correctement après F5 (recover).

---

## 11. Phase 7 — Validation & durcissement (~2 j)

- [ ] **7.1 Test de cohérence moteur-vs-live (LE critère)** : rejouer une session sim crypto archivée récente avec la config de l'époque → comparer avec `copied_positions`/`executions` réels : positions communes ≥ 90 %, timestamps d'entrée ±2 s, |ΔPnL| ≤ 5 % (écarts expliqués par latence live, fills depth, poll vs tick). Écarts documentés dans `fidelity_warnings` ou corrigés.
- [ ] **7.2** Même exercice copy sur la semaine écoulée (tolérances plus larges : prix mid horaire).
- [ ] **7.3** Test déterminisme : 2 runs identiques → hash des positions identique.
- [ ] **7.4** Test charge : run crypto 30 j × N symboles < 5 min, mémoire backend < +500 MB (streaming SQL obligatoire).
- [ ] **7.5** E2E UI (pattern `E2eTestsPage`) : lancer un mini-run 1 h via l'onglet Backtests.
- [ ] **7.6** Docs : `docs/backtest.md` (architecture, fill models, fidélité, API), mise à jour `docs/modele-donnees.md` (3 tables), `docs/metrics.md` (4 métriques), `docs/api.md`.

---

## 12. Séquençage & dépendances

```
Phase 0 (données) ──┬──> Phase 1 (noyau) ──> Phase 2 (crypto) ──┬──> Phase 5 (API) ──> Phase 6 (UI) ──> Phase 7 (validation)
                    │                          Phase 4 §8.1 ────┘         (FillEngine)
                    └──> Phase 3 (weather) ──> Phase 4 (copy) ────────────┘
                 (0.2 dépend du plan crypto 3.A — mutualisation)
```

| Phase | Effort | Bloque | Notes |
|---|---|---|---|
| 0 Fondations données | 2–3 j | tout | 0.2 mutualisé avec plan crypto 3.A.6 ; 0.3 = collecte à démarrer ASAP (historique weather) |
| 1 Noyau moteur | 3–4 j | 2/3/4 | refactor core sans impact live |
| 2 Crypto | 3–4 j | démo première | données déjà dispo (24 h+) |
| 3 Weather | 2–3 j | — | exploitable pleinement après accumulation 0.3 |
| 4 Copy + FillEngine | 2–3 j | — | §8.1 à livrer en fait dès Phase 2 |
| 5 API + Prometheus | 2 j | UI | |
| 6 UI | 3–4 j | — | |
| 7 Validation | 2 j | mise en prod | critère 7.1 non négociable |

**Total : ~17–23 j.** Jalons : M1 = Phases 0–2 (backtest crypto en CLI/API), M2 = Phases 3–5 (3 domaines + API), M3 = Phases 6–7 (UI + validation).

---

## 13. Risques & garde-fous

| Risque | Mitigation |
|---|---|
| Divergence moteur vs live (faux sentiment de confiance) | Critère 7.1 obligatoire ; `engine_version` ; réutilisation stricte du code core (pas de copie modifiée) |
| Sur-interprétation des fills sans book depth | Modèle conservateur par défaut + warnings quantifiés + fill partiel ; jamais de fill au mid pur en crypto |
| Run CPU-long bloque le backend | Streaming SQL + yields `setImmediate` ; verrou singleton ; si mesure > seuil en prod → migrer vers spawn child (pattern E2E) sans changer l'API |
| Purge des données pendant qu'un run lit | Le run snapshot `data_range` au départ ; lecture par curseur ; rétentions Phase 0 largement au-delà des durées de run |
| Config drift entre runs | `config_snapshot_json` + fingerprint ; l'UI affiche le diff vs live |
| Historique weather/copy trop court au départ | Data-coverage affiché avant lancement ; le plan accepte que la valeur weather grandisse avec le temps de collecte |
| Résolution inconnue (winning_outcome manquant) | Close au dernier mid + warning comptabilisé ; jamais de payout inventé |

---

## 14. Hors scope v1 (explicite)

- **Grid search / optimisation paramétrique** (boucle de runs) : v2 — v1 = un run par lancement, comparaison A/B manuelle.
- **Backtest réel** (mode `real`) : non — le moteur rejoue la logique en sim mathématique.
- **Book L2 recorder** (profondeur) : chantier collecte séparé si le fill model s'avère trop conservateur.
- **Walk-forward / Monte-Carlo** : v2.
- **Multi-runs parallèles** : verrou singleton v1.

---

## 15. Livrables liés

- Plan crypto 5 min (dépendance 0.2 ↔ 3.A.6, Phase 5.1 complétée par ce plan) : `docs/plans/2026-08-05_PLAN-strategies-crypto-algo-5min.md`
- Audits : `docs/audits/2026-08-05_audit-naive-momentum-config.md`, `docs/audits/2026-08-05_strategies-5min-binary-crypto.md`
- Docs à créer/maj : `docs/backtest.md`, `docs/modele-donnees.md`, `docs/metrics.md`, `docs/api.md`
- Code réutilisé : `packages/core` (risk, sizing, pricing, simulation), `packages/crypto-algo` (strategies, mid-history), `packages/weather-algo`, `packages/copy-trading` (gates)
