# Package `@polywatch/crypto-algo`

Couche de trading algorithmique sur marchés crypto court-terme de Polymarket. Le
package détecte des marchés éligibles (auto-track), évalue des stratégies
débranchables en temps réel (WebSocket book + polling Gamma), émet des signaux
d'entrée réutilisant le pipeline de sizing/réservation du copy-trading, et
enregistre une surveillance de marché (snapshots open/close) pour analyse.

> État : MVP — **une seule stratégie** (`naive-momentum`) est implémentée à ce
> jour. Le registre est conçu pour en accueillir d'autres (voir
> [`../plans/websocket-crypto-algo-plan.md`](../plans/websocket-crypto-algo-plan.md)
> et [`../plans/IMPLEMENTATION_PLAN_CRYPTO_ALGO_V2.md`](../plans/IMPLEMENTATION_PLAN_CRYPTO_ALGO_V2.md)).

## Démarrage (`index.ts`)

1. Initialisation `DataSource` PostgreSQL (via `DATABASE_URL`), `assertDatabaseExists`.
2. `seedCryptoAlgoWatchlistEntry` — crée idempotemment une entrée de watchlist sentinelle dont `traderAddress = 'crypto-algo'` (`CRYPTO_ALGO_TRADER_ADDRESS`). Les positions/exécutions algo héritent de ce `watchlistId`, ce qui les rend visibles dans l'UI copy-trading classique.
3. Services : `RiskService`, `createAlgoSelectionServices` (`MarketService` + `AlgoMarketSelectionService`), `AlgoAutoTrackService`, `ReservationService`, `SimulationService`.
4. **3 connexions Redis** dédiées : commandes, pub (heartbeat), sub (`config-changed`).
5. `SelectionLoader` (snapshot mémoire des sélections actives, refresh pub/sub + safety net 60 s).
6. `StrategyRegistry` + enregistrement de `NaiveMomentumStrategy`.
7. `PolymarketConnectionManager` (WebSocket book partagé) + `RedisQueue<OrderSignal>` vers la file `order-signals`.
8. `CryptoAlgoPriceFeed` branché sur le connection manager ; les callbacks book
   sont **composés** via `dispatchBookUpdate()` (price feed + percent publisher
   partagent le même handler `setOnBookUpdate` sans s'écraser).
9. `waitForBackendReady` (canal Redis `backend-ready`, timeout 60 s) avant de continuer.
10. Lecture `CryptoConfig.cryptoAlgoEnabled` — si désactivé, démarre en *standby*.
11. `StrategyRunner` (évaluation + WebSocket), `AlgoMarketPercentPublisher`, `MarketSurveillanceRecorder`, **`PriceTickRecorder`** (1 Hz).
12. Connexion WebSocket + abonnement aux `conditionId` actifs (fallback polling si échec).
13. Boucles : `strategyRunner.start(pollMs)` (polling de secours), **market janitor** (délai adaptatif selon les règles auto-track), `surveillance-refresh` (60 s), `surveillance-janitor` (snapshots non résolus), **`price-tick-recorder`** (1 s), `heartbeat` (30 s).
14. Abonnement `config-changed` : reload selections + risk config, resync WS, replanification du janitor.

### Resilience patterns

- **`runMarketJanitorTick`** : enveloppé dans un `try/catch` global — une erreur DB/Gamma pendant le cycle janitor est loguée (`log.error`), le service continue.
- **`SelectionLoader.reload()`** : méthode séparée de `load()` (boot) — `reload()` (runtime) catche silencieusement les erreurs DB, le service conserve son snapshot stale.
- **`CryptoAlgoPriceFeed.subscribeToMarkets()`** : `try/catch` global — une erreur `ensureTradableMarket` ou `reconcile` est loguée, les subscriptions partielles restent en place.
- **`MarketSurveillanceRecorder.captureOpen()` / `captureClose()`** : `try/catch` dans chaque méthode — une erreur DB pendant l'enregistrement d'un snapshot ne fait pas crash le service.

### Shutdown (`SIGTERM` / `SIGINT`)

Le handler `shutdown()` (async) exécute l'arrêt ordonné :

1. Flag `shuttingDown` anti re-entrance (double signal ignoré).
2. `clearInterval` des 4 timers périodiques (`marketJanitorTimer`, `heartbeatTimer`, `surveillanceRefreshTimer`, `positionContextRefreshTimer`).
3. `stopSurveillanceJanitor()`, `priceTickRecorder.shutdown()`, `surveillanceRecorder.shutdown()`, `strategyRunner.stop()`.
4. `selectionLoader.stop()` (try/catch).
5. `safeQuit` des 3 connexions Redis (cmd, pub, sub) — `.catch(() => {})` pour absorber les rejections sur connexion déjà fermée.
6. `ds.destroy().catch(() => {})`.
7. `process.exit(0)`.

L'intervalle de polling est configurable via `CRYPTO_ALGO_POLL_MS` (défaut 30 000).

## Processus & boucles

| Composant | Cadence | Rôle |
|---|---|---|
| `StrategyRunner` | `pollMs` (fallback) + déclenchements WebSocket | Évalue les stratégies actives sur les marchés évaluables → callback `onSignal` |

**Cache Gamma (`fetchGammaMarketCached`)** : TTL et stale-on-error via `CryptoConfig` uniquement (`resolveGammaCacheTtlMs`, `resolveGammaStaleOnErrorFactor`). `applyRiskTunables` doit être appelé avant `start()` ; sans config, les requêtes Gamma retournent `null` (plus de constantes TTL locales ni flag `feature.deprecated_fallbacks_enabled`). Re-entry : `cryptoAlgoReentryWindowMs` / `cryptoAlgoMaxEntriesPerWindow` (ctor `reEntryWindowMs === 0` = bypass e2e uniquement).
| `CryptoAlgoPriceFeed` | temps réel (WS) | Cache top-of-book, debounce 5 s par `conditionId`, callbacks `onPriceUpdate` / `onMarketResolved` |
| Market janitor (`auto-track-janitor.ts`) | délai adaptatif | Résout/désactive les marchés expirés, découvre de nouveaux marchés via `AlgoAutoTrackService` |
| `surveillance-refresh` | 60 s | Rafraîchit les cibles de surveillance (`buildSurveillanceTargets`) |
| Surveillance janitor | périodique | Marque `unresolvedAt` sur les snapshots dont la clôture n'arrive jamais (fallback table `markets`) |
| `PriceTickRecorder` | 1 s | Enregistre ticks UP/DOWN + métriques dans `algo_price_ticks` pour marchés en surveillance active |
| Heartbeat | 30 s | Publie `heartbeat` + clé `crypto-algo:heartbeat` (TTL 60 s) |

## Stratégies

Interface commune (`strategy/strategy.ts`) :

```ts
interface CryptoAlgoStrategy {
  readonly id: string;
  evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null>;
}
```

`AlgoSignal` : `conditionId`, `assetId` (token YES ou NO), `outcome` (`'YES'|'NO'`), `side: 'BUY'`, `confidence` (0..1), `reasons[]`, `strategyId`, `interval`.

### `naive-momentum` (`strategy/implementations/naive-momentum.strategy.ts`)

Stratégie d'entrée par **bande de prix** (token acheté) + garde spread sur le carnet cible :

- **Prix de référence** : mid WebSocket du token **Up** si carnet frais et bilatéral ; sinon prix Gamma YES. Helper exporté : `resolveEntryCandidateFromBand(yesPrice, min, max)`.
- **Bande d'entrée (activée par défaut)** : le token qu'on va acheter doit être dans `(entryPriceMin, entryPriceMax)` — défaut `(0,50 ; 0,80)` :
  - YES si `0,50 < prix Up < 0,80`
  - NO si `0,50 < (1 − prix Up) < 0,80`
  - Abstention `price_band` sinon (y compris aux bornes exactes 0,50 / 0,80)
- **Mode legacy** (`entryPriceBandEnabled = false`) : seuil momentum `baseThreshold` (0,55) + ajustement spread absolu sur le token cible ; abstention `neutral_zone` en zone neutre.
- **Spread max par intervalle** (table mergée `cryptoAlgoSpreadAbsByInterval`) : ex. 5m → 0,05 absolu. Au-delà → `spread_gate`.
- **Garde liquidité** : carnet cible (Up/Down selon direction) frais + bilatéral obligatoire.
- Confiance pénalisée par le spread au-dessus de `minSpreadAbsForAdjustment`.

Le registre des stratégies (`strategy/registry.ts`) filtre aux ids activés dans
`CryptoConfig.cryptoAlgoStrategies` (JSON, défaut `["naive-momentum"]`).

## Re-entry guard (`strategy-runner.ts`)

Au plus `cryptoAlgoMaxEntriesPerWindow` (défaut 1) **enqueue réussi** par
`conditionId:outcome` sur une fenêtre de `cryptoAlgoReentryWindowMs` (défaut :
durée de l'intervalle marché, sinon 1 h). YES et NO ont des compteurs séparés.
Un skip pipeline ne consomme pas de slot ; `recordSignal` n'est écrit qu'après
enqueue. Configurable dans Settings → Crypto algo → Re-entrée.

## Pipeline d'entrée (`processors/algo-entry-pipeline.ts`)

`runAlgoEntryPipeline` réutilise la mécanique copy-trading pour chaque `AlgoSignal` :

- `'sim'` s'exécute toujours ; `'real'` uniquement si `realTradingEnabled`.
- Sizing via `computeEntryTargetQuantity`, garde-fous `MIN_ORDER_SHARES` /
  `MIN_ORDER_USDC`, plafond `getModeMaxPositionSizeUsdc`, réservation
  transactionnelle (`ReservationService`), idempotence `hashAlgoOrderSignalId`
  (clé inclut le **mode** `sim`/`real`).
- **Reprise réservation** : même mécanisme que le copy-trading via
  `resumeEntryFromReservation` (`@polywatch/core`) si l'enqueue Redis échoue
  après `reserve`.
- Paramètres de sortie hérités du mode, surchargeables par `CryptoConfig.cryptoAlgo*`
  (`getCryptoAlgoExitParams`, `resolveCryptoAlgoMinTimeToClose`).
- En mode réel : solde disponible on-chain via `fetchAvailableRealCash`.
- Enfile un `OrderSignal` dans la file Redis `order-signals` (consommée par les
  `Executor` du worker principal — voir [`04-worker.md`](04-worker.md)).

Retourne `null` en cas de succès, ou une raison FR d'abandon (skip).

## Filtre courbe descendante (entry)

Gate optionnel dans `NaiveMomentumStrategy` — **desactive par defaut**.

```
CryptoAlgoPriceFeed.handleBookUpdate
  → MidHistoryBuffer.record (avant debounce eval)
StrategyRunner.evaluateSelectionUnlocked
  → getOutcomeMidHistory (si curveFilterEnabled)
  → NaiveMomentumStrategy.evaluate
    → evaluateCurveDescendingGate → curve_descending | pass | insufficient
```

| Module | Role |
|--------|------|
| `mid-history-buffer.ts` | Ring buffer mids WS par asset (decimation 500 ms, cap 60 s) |
| `curve-descending-gate.ts` | `delta = last.mid - first.mid`, min 3 points, span >= 50 % lookback |
| `price-feed.ts` | Record + `clearAll()` au disconnect |

Abstain `curve_descending` propage comme les autres (`algo_price_ticks.last_abstain_reason`).

Patches : [`../patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md`](../patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md), [`../patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md`](../patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md).

## Sorties algo (worker partagé)

Les sorties (SL/TP/trailing/pre-close/kill switch) ne sont **pas**
implémentées dans crypto-algo : elles passent par le worker principal
(`StrategyProcessing` → `position-exit-evaluator.ts`) avec paramètres résolus
via `getCryptoAlgoExitParams` / `resolveAlgoEntryExitParams` /
`getCryptoPositionPreCloseParams` (`core/src/risk/crypto-algo-exit.ts`).

### Pre-close

Fenêtre unique avant `endDate` (`preCloseSeconds`) : `PRE_CLOSE_LOSS` /
`PRE_CLOSE_WIN` selon PnL ; keep optionnel si bid ≥ seuil. Pas de phase HARD /
`TIME_EXIT`. Voir [`../crypto-algo.md`](../crypto-algo.md#6-sorties-sltptrailingpre-close).

## Historique de prix (`price-tick-recorder.ts`)

`PriceTickRecorder` enregistre à **1 Hz** les prix UP/DOWN des marchés en
surveillance active dans `AlgoPriceTick`, avec métriques enrichies (spread,
liquidité, exposition positions algo). Dépend de :

- `SignalStateRegistry` — état des signaux récents par marché ;
- `PositionContextCache` — cache positions algo ouvertes pour agrégats PnL (refresh 5 s).

**Pas de `market_position_ticks` pour crypto-algo.** Le worker
(`MarketTickRecorder`) ignore les positions dont `reason` commence par `ALGO_`
(`isAlgoPositionReason`). La table `market_position_ticks` reste réservée au
**copy trading** et **weather-algo** ; écrire les deux pour crypto serait
redondant avec `algo_price_ticks` (déjà BBO+VWAP+signal dès la surveillance,
avant même qu'une position soit ouverte).

Purge des ticks > 24 h (configurable UI : `cryptoAlgoTickRetentionHours`). Exposé
au frontend via `GET /api/algo/market-chart/:conditionId`.

Le champ `recordedAt` est fourni explicitement par `PriceTickRecorder` depuis le
`now` du cycle de tick, ce qui aligne l'axe temporel du graphique avec
l'instant réel du prix plutôt qu'avec l'insertion en base. L'événement WebSocket
`algo_chart_tick` (`t`) utilise le même `now`, assurant la cohérence entre le
push live et les points historiques. Le recorder accepte un dernier tick durant
un intervalle après `marketEndMs`, pour capturer le point de clôture malgré une
dérive du timer.

## Surveillance marché (`market-surveillance-recorder.ts`)

`MarketSurveillanceRecorder` capture, par marché surveillé, un snapshot open
(prix UP/DOWN à l'ouverture) et un snapshot close (à la résolution), persisté
dans `algo_surveillance_snapshots`. Utilisé pour le post-mortem stratégie. Les
cibles sont calculées par `buildSurveillanceTargets` (règles auto-track +
sélections + marchés futurs découverts).

## Auto-track (`AlgoAutoTrackService`, core)

Règles `{ cryptoSymbol, interval, enabled }` (`algo_auto_track_rules`) qui
déclenchent la découverte automatique de marchés éligibles
(`discoverBestAutoTrackMarket`, `discoverBestFutureAutoTrackMarket` dans
`core/polymarket/auto-track-discovery.ts`). `syncAfterMarketResolved` enchaîne
sur le prochain marché quand le courant se résout.

## Arborescence

```
crypto-algo/src/
├── config.ts                       env (DATABASE_URL, BACKEND_URL, GAMMA/CLOB/WS, CRYPTO_ALGO_POLL_MS)
├── index.ts                        bootstrap (datasource, services, WS, boucles, shutdown)
├── price-feed.ts                   CryptoAlgoPriceFeed (cache top-of-book, mid history, debounce)
├── mid-history-buffer.ts           ring buffer mids WS pour filtre courbe
├── curve-descending-gate.ts        evaluateCurveDescendingGate (delta first→last)
├── selection-loader.ts             snapshot mémoire des sélections actives (pub/sub + 60 s)
├── real-cash.ts                    solde disponible on-chain (mode réel)
├── runtime-status.ts               publie le statut runtime dans Redis (clé crypto-algo:runtime-status)
├── watchlist-seed.ts               entrée watchlist sentinelle 'crypto-algo'
├── algo-percent-publisher.ts       publie les % de marché au backend (live book updates)
├── auto-track-janitor.ts           résolution + découverte de marchés (cadence adaptative)
├── surveillance-janitor.ts         marque les snapshots non résolus
├── surveillance-targets.ts         calcul des cibles de surveillance
├── market-surveillance-recorder.ts capture snapshots open/close
├── price-tick-recorder.ts          ticks 1 Hz → AlgoPriceTick (chart API)
├── signal-state-registry.ts        état signaux récents (enrichissement ticks)
├── position-context-cache.ts       cache positions algo ouvertes
├── post-entry-mid-logger.ts        samples mid +1s/+5s/+30s → post_entry_mid_samples
├── processors/
│   └── algo-entry-pipeline.ts      sizing + réservation + file algo-order-signals
└── strategy/
    ├── strategy.ts                 interface CryptoAlgoStrategy, AlgoSignal, StrategyContext, AbstainReasonCode (15)
    ├── registry.ts                 StrategyRegistry (filtre par cryptoAlgoStrategies)
    ├── strategy-runner.ts          boucle d'évaluation + re-entry guard + WS
    ├── constants.ts                VALID_INTERVALS, SPREAD_ABS_BY_INTERVAL, helpers
    └── implementations/
        └── naive-momentum.strategy.ts
```

## Miroir weather-algo (C8)

Même squelette que `@polywatch/weather-algo` (sentinelle, Redis, pipelines, janitors).
Drift légitime : crypto = WS price-feed + SL/TP worker ; weather = poll + exit
in-package + forecast. **Pas** d'`AlgoStrategyRunner` partagé — copie consciente
uniquement. Voir [`08-weather-algo.md`](./08-weather-algo.md) § Miroir et
[`../crypto-algo.md`](../crypto-algo.md) §10.

## Configuration (extrait `CryptoConfig`)

| Champ | Défaut | Rôle |
|---|---|---|
| `cryptoAlgoEnabled` | `false` | Master toggle de la couche d'exécution algo (standby si false) |
| `cryptoAlgoStrategies` | `["naive-momentum"]` | IDs des stratégies activées (JSON) |
| `cryptoAlgoEntryPriceBandEnabled` | `true` | Bande d'entrée active (remplace threshold momentum) |
| `cryptoAlgoEntryPriceMin` | `0.50` | Borne basse exclusive (prix token acheté) |
| `cryptoAlgoEntryPriceMax` | `0.80` | Borne haute exclusive (prix token acheté) |
| `cryptoAlgoCurveFilterEnabled` | `false` | Filtre courbe descendante sur token acheté |
| `cryptoAlgoCurveLookbackMs` | `10000` | Fenêtre mid WS (ms, max 60 000, clamp runtime) |
| `cryptoAlgoCurveMinDelta` | `0.01` | Seuil descente (prob points) ; abstain si `delta < -seuil` |
| `cryptoAlgoBaseThreshold` | `0.55` | Seuil momentum legacy (si bande désactivée) |
| `cryptoAlgoSlPercent` / `cryptoAlgoTpPercent` | `null` | Surcharge SL/TP (`null` = hérite du mode). **Globaux** — s'appliquent au sim et au real. |
| `cryptoAlgoSlBidPoints` / `cryptoAlgoTpBidPoints` | `null` | Surcharge SL/TP en **bid absolu** (points de probabilité) pour marchés binaires. `null` = default intervalle (5m : 0,10 / 0,12). `0`/négatif = désactivé (fallback %). Priorité sur le mode % si actif. Voir `docs/patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`. |
| `cryptoAlgoTrailingStopPercent` / `cryptoAlgoActivationPercent` | `null` | Surcharge trailing |
| `cryptoAlgoPreCloseEnabled` | `false` / `null` | Pré-clôture (`true` = active ; `null`/`false` = off, pas d'héritage copy) |
| `cryptoAlgoPreCloseSeconds` | `null` | Fenêtre pre-close (secondes). `null` = résolution par interval via `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` : 5m→120s, 10m→120s, 15m→180s, 30m→240s, 1h→300s, 4h/1d→600s. |
| `cryptoAlgoPreCloseKeepEnabled` | `null` / `false` | Keep gagnantes (`true` = tenir si bid ≥ seuil). |
| `cryptoAlgoPreCloseKeepBidThreshold` | `null` | Seuil bid keep (ex. 0,80). |
| `cryptoAlgoMinTimeToClose` | `null` | Secondes minimales avant `endDate` pour autoriser une entrée. `null` = `preCloseSeconds(interval) + 30s`. |

Plafond taille position : `getModeMaxPositionSizeUsdc(risk, mode)` — pas de champ algo dédié.

## Statut runtime

`CryptoAlgoRuntimeStatusPublisher` écrit dans Redis (`crypto-algo:runtime-status`,
TTL 120 s) : `enabledSelections`, `evaluableSelections`, `wsConnected`,
`lastEvaluatedAt`, `lastSkipReason/At`. Exposé par le backend via
`GET /api/algo-markets/status` (voir [`../api.md`](../api.md)).

## Points de raccordement

- **Worker principal** : consomme la file `order-signals` (ordres algo exécutés
  par les mêmes `Executor` que le copy-trading).
- **Backend** : routes `/api/algo-*` (gestion sélections, auto-track, capital,
  exécutions, prix marchés, historique surveillance, **market-chart**, statut
  runtime) et routes internes `/api/internal/market-ticks`,
  `/market-pct-updates`, `/metrics/circuit-breaker` — voir [`../api.md`](../api.md).
  Crypto-algo notifie les changements de marchés via
  `POST /api/algo-markets/notify-changed` (sans auth — appel worker de confiance).
- **Frontend** : page `crypto-algo` (`CryptoAlgoPage`,
  `CryptoAlgoSettingsDialog`, `CryptoAlgoNotificationsDialog`, `AlgoMarketCard`,
  `SurveillanceHistoryCard`) — voir [`06-frontend.md`](06-frontend.md).
  Les événements de surveillance algo sont également exposés dans le panneau
  **Événements** de la page Simulation (`EventsPanel` + `AlgoEventRow`,
  filtrable par source Copy/Algo via `GET /api/algo/events`).
- **Watchlist** : l'entrée sentinelle `'crypto-algo'` fait apparaître les
  positions algo dans les dashboards Simulation / Réel.
