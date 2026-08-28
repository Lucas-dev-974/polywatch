# Package `@polywatch/core`

Domaine partagé entre backend et worker : entités, services, calculs métier. Tout est testé via Vitest (`*.test.ts` colocalisés).

## Arborescence

```
core/src/
├── config/        env (.env racine, chemins), secrets (validation prod)
├── database/      DataSource TypeORM PostgreSQL (pg driver)
├── entities/      60 entités TypeORM
├── idempotence/   hashes SHA-256 des événements et ordres
├── market/        domaine métier : lifecycle (settled/payoff), classifier, tags Gamma, market-type
├── move-events/   règles de pertinence des événements
├── orders/        construction des signaux de fermeture
├── polymarket/    intégration API/WS/on-chain : signature, market-list, book-freshness, rate-limit, discovery, pUSD
├── positions/     prix mark, labels d'outcome
├── pricing/       VWAP (walkBook), frais taker
├── queue/         définition des 6 files worker + dead-letter
├── risk/          policy + exit-decision + crypto/weather tunables & config-api + sim-execution-tunables
├── seed/          défauts initiaux + backfill config héritée
├── services/      68 fichiers / 49 hors tests / 39 `*.service.ts` (incluant quartet Global/Copy/Crypto/WeatherConfigService étendant `BaseConfigService<T>` ; + market-*-tick, real-*, simulation-*, algo-surveillance helpers, market-price-history-backfill)
├── simulation/    accounting cash, algo-kind, trader-rollup (wrapper), analytics, snapshot-decision-collector, auto-snapshot
├── snapshot/      helpers purs partagés sim/real — `decision-collector-shared`, `trader-rollup-shared` (`buildTraderRollup`)
├── sizing/        compute, entry-sizing, entry-mos / resolve-entry-mos, depth-retry, enqueue, resume-reserved
├── traders/       `isPollableTraderAddress` (filtre Data API — exclut sentinelles algo)
├── types/         types partagés (TradingMode, OrderSignal, etc.)
├── crypto-algo/   optimize-report, config-fingerprint, comparaison rapports
├── lib/           utilitaires (`ttl-cache`, `algo-price-tick-snapshot`, `safe-parse-json`, `to-iso`, `is-postgres`)
├── real/          trader-rollup (wrapper), snapshot-decision-collector, locks advisory rotation/auto-snapshot
├── redis/         factory, sim-reset hygiene (incl. `:dead` + `::retries`), algo-entry-cooldown, crypto-reentry-throttle, weather-reentry/hysteresis, pub/sub
├── trader-insight/ construction des profils trader (capital, funding, insight)
├── worker/        paramétrage MoveDetector (move-detector-settings)
├── worker-shared/ RedisQueue (`JobDiscardedError`), safe-interval, backend client/readiness, connection-manager interface
├── weather/       découverte marchés météo, Open-Meteo, forecast distribution, edge, exit helpers
├── migrate.ts     création du schéma + seed (one-shot)
├── migration-backfill.ts  backfill colonnes héritées
└── migrations/    **80** fichiers TypeORM — inventaire récent ci-dessous
```

### Migrations récentes (0081–0095)

| # | Fichier | Objet |
|---|---------|--------|
| 0081 | `WeatherPositionForecastUnique…` | Unique forecast par position |
| 0082 | `WeatherCityFollow…` | Colonnes city-follow |
| 0083 | `AddWeatherAlgoModeToggles…` | Toggles sim/real weather |
| 0084 | `SimBalancePerAlgoKind…` | `simulation_balances.algo_kind` |
| 0085 | `SimSessionsPerAlgoKind…` | Sessions par algo kind |
| 0086 | `AddSimInitialCapitalPerAlgoKind…` | Capital initial par kind |
| 0087 | `SplitRiskConfigPerAlgoKind…` | Split → Global/Copy/Crypto/Weather |
| 0088 | `DropLegacyRiskConfig…` | Drop table `risk_config` |
| 0089 | `WeatherCityFirstSelection…` | City-first + hysteresis/throttle |
| 0090 | `EnsureRiskConfigFingerprintNullable…` | `config_fingerprint` nullable |
| 0091 | `DropWeatherMarketSelections…` | Drop `weather_market_selections` |
| 0092 | `AddWeatherAlgoMinForecastProbability…` | Min forecast probability |
| 0093 | `CryptoAlgoStopBleed…` | Stop-bleed (SL off, band floor…) |
| 0094 | `AddCryptoAlgoStrategyParams…` | `crypto_algo_strategy_params` JSON |
| 0095 | `CreatePostEntryMidSamples…` | Table `post_entry_mid_samples` |

## Entités (PostgreSQL)

| Entité | Table | Points clés |
|---|---|---|
| `User` | `users` | Mono-utilisateur, `password_hash` bcrypt (coût 12) |
| `WatchlistEntry` | `watchlist` | Adresse trader lowercase, flags `active`/`simEnabled`/`realEnabled`, max 20 |
| `GlobalConfig` | `global_config` | Slippage, real trading flag, realism sim, auto-snapshots — **remplace** l'ancienne façade monolithique `RiskConfig` (purgée) |
| `CopyConfig` | `copy_config` | Limites/sizing/sorties/filtres copy-trading (paires sim/real), MoveDetector interval |
| `CryptoConfig` | `crypto_config` | Enable/stratégies, sizing, SL/TP/trailing/pre-close, re-entry, SL quota, curve/band, tunables stratégie |
| `PostEntryMidSample` | `post_entry_mid_samples` | Mid Up/Down post-entrée algo (+1s/+5s/+30s), rétention 14 j |
| `ClobCredentials` | `clob_credentials` | apiKey/secret/passphrase/signerPrivateKey **chiffrés AES-256-GCM**, signatureType |
| `WalletAccount` | `wallet_accounts` | Deposit address + funder + signer PK chiffré |
| `TraderSnapshot` | `trader_snapshots` | UNIQUE(trader, conditionId, assetId) — dernière position connue |
| `TraderSnapshotSeq` | `trader_snapshot_seq` | Séquence monotone par trader (idempotence) |
| `MoveEventEntity` | `move_events` | id = hash SHA-256, type OPENED/INCREASED/DECREASED/CLOSED, flag `processed` |
| `CopiedPosition` | `copied_positions` | Statuts : `pending → open → closing → closed` (+ `failed`, `pending_resolution`, `cancelled`) ; `entryPrice`, `entryBidVwap`, `entryQuantityRemaining`, `entryFeesRemaining`, PnL réalisé/latent, `peakClosurePnlPercent` (pic de closure PnL pour trailing), `peakBidVwap` (pic du bid, rétention historique), `slPercent` / `tpPercent` / `trailingPercent` / `trailingActivationPercent` (% de la mise), `closingAttemptSeq`, `closingReason`, `closeReason` |
| `Execution` | `executions` | Statuts `placing → filled/failed` ; fillPrice (VWAP pondéré sur partiels), fillQuantity, fees, realizedPnl, clobOrderId |
| `PositionReservation` | `position_reservations` | Notionnel USDC réservé, TTL 180 s |
| `SimulationBalance` | `simulation_balances` | Cash pUSD sim **par `algoKind`** (`crypto` / `weather` / `copy`, unique) |
| `SimulationStateSnapshot` | `simulation_state_snapshots` | Archives d'état sim (JSON config/traders/positions/exécutions) — [`../reference/snapshots-simulation.md`](../reference/snapshots-simulation.md) |
| `Market` | `markets` | tokenIdYes/No, endDate, negRisk, `feeRate`/`feeExponent` (frais CLOB dynamiques), lifecycle (active/resolved/closed/acceptingOrders/winningTokenId), `category`, `tagSlugs` (cache filtre copie), `marketType` |
| `AlgoAutoTrackRule` | `algo_auto_track_rules` | Règle auto-track `(cryptoSymbol, interval)` unique, flag `enabled` |
| `AlgoMarketSelection` | `algo_market_selections` | Marché sélectionné pour crypto-algo (`conditionId`, `cryptoSymbol`, `interval`, `slug`, `enabled`) |
| `WeatherMarketSelection` | `weather_market_selections` | **Supprimé** — remplacé par `WeatherAutoTrackRule` (city-first) |
| `WeatherAutoTrackRule` | `weather_auto_track_rules` | **Sélection active** : ville (`city`, `highest_temp`, `lookAheadDays`, `mode=city_follow`) |
| `WeatherConfig` | `weather_config` | Config weather-algo (globaux + 4 colonnes per-env `sim*`/`real*` stratégies/params ; legacy `weatherAlgoStrategies` figé) |
| `WeatherForecastCache` | `weather_forecast_cache` | Cache prévisions Open-Meteo (city, date, metric, mean, stdDev) |
| `WeatherPositionForecast` | `weather_position_forecasts` | Snapshot forecast + bounds de bucket à l'ouverture |
| `AlgoSurveillanceSnapshot` | `algo_surveillance_snapshots` | Snapshot OHLC surveillance (open/close up/down, `marketStartAt`/`EndAt`, `unresolvedAt`) — `UNIQUE(conditionId)` |
| `AlgoPriceTick` | `algo_price_ticks` | Ticks UP/DOWN 1 Hz (`PriceTickRecorder`) + métriques enrichies ; purge > 24 h ; chart API |
| `IntegrationSettings` | `integration_settings` | Paramètres d'intégration tiers (clé API Polygonscan chiffrée, singleton) |
| `MarketPositionTick` | `market_position_ticks` | Tick de marché persisté par book update (throttle 500 ms/asset) pour les assets avec positions **copy/weather** ouvertes : `bestBid`/`bestAsk`/`midPrice`/`spread`/`spreadPercent`, VWAP exécutables (`executableBidVwap`/`executableAskVwap`), `lastTradePrice`. **Pas** pour crypto-algo (`ALGO_*`) — série dans `algo_price_ticks`. Index : `copiedPositionId`, `(conditionId, createdAt)`, `(assetId, createdAt)`, `createdAt`. Rétention théorique 30 j (`MARKET_TICK_RETENTION_DAYS`) — **purge horaire worker désactivée** |
| `E2eTestRun` | `e2e_test_runs` | Runs de tests E2E (suite, statut, durée, logs) — démarrés via `/api/e2e-runs` |
| `E2eRunPosition` | `e2e_run_positions` | Positions d'un run E2E (conditionId, prix d'entrée, PnL, statut) |
| `SimulationSession` | `simulation_sessions` | Sessions de simulation entre deux resets **par `algoKind`** (une active par kind) |
| `RealSession` | `real_sessions` | Périodes de trading réel entre deux clôtures (même forme que SimulationSession) |
| `RealSessionState` | `real_session_state` | Pointeur singleton vers la période réelle active |
| `RealStateSnapshot` | `real_state_snapshots` | Archives d'état réel (sources `manual`, `auto`, `rotate`) |
| `RealArchivePosition` | `real_archive_positions` | Positions réelles fermées archivées par période |
| `RealArchiveExecution` | `real_archive_executions` | Exécutions réelles archivées |
| `RealArchiveExitAttempt` | `real_archive_exit_attempts` | Tentatives de sortie réelles archivées |
| `SimArchivePosition` | `sim_archive_positions` | Positions sim archivées par session |
| `SimArchiveExecution` | `sim_archive_executions` | Exécutions sim archivées |
| `SimArchiveExitAttempt` | `sim_archive_exit_attempts` | Tentatives de sortie sim archivées |
| `SimArchiveSurveillance` | `sim_archive_surveillance` | Surveillance algo archivée |
| `SimArchivePriceCandle` | `sim_archive_price_candles` | Bougies 1 min agrégées (ticks) |
| `RiskConfigRevision` | `risk_config_revisions` | Journal append-only des mises à jour config isolées (`configKind` = global/copy/crypto/weather ; source, patch_json, config_json, config_fingerprint) |
| `AnalysisReport` | `analysis_reports` | Snapshots de rapports d'analyse persistés (type, label, params_json, payload_json, config_fingerprint) |
| `MarketPriceTick` | `market_price_ticks` | Ticks de marché par `conditionId` (timer 1s, indépendant des positions) pour graphique UI non-crypto |
| `MarketPriceHistorySync` | `market_price_history_sync` | Registre de synchronisation de l'historique des prix de marché |
| `MarketSyncConfig` | `market_sync_config` | Configuration de synchronisation des marchés (intervalles, backoff, concurrency) |
| `SystemConfig` | `system_config` | Configuration système clé/valeur avec catégorisation |
| `ExitAttemptEvent` | `exit_attempt_events` | Journal des tentatives de sortie (SL/TP/PRE_CLOSE) avec mark price et raison de blocage |
| `ClobLatencySample` | `clob_latency_samples` | Échantillons de latence RTT d'exécution CLOB pour le calibrage simulation |
| `ShadowFill` | `shadow_fills` | Fills simulés (shadow logging) pour l'audit de réalisme d'exécution |
| `WeatherForecastHistory` | `weather_forecast_history` | Historique append-only des fetchs Open-Meteo (backtest) |
| `WeatherMarketSnapshot` | `weather_market_snapshots` | Snapshot marché par cycle × ville × date |
| `WeatherBucketTick` | `weather_bucket_ticks` | Prix YES/NO d'un bucket actif (timeline / ridge / backtest) |
| `WeatherEvaluationLog` | `weather_evaluation_log` | Journal signal/abstain weather (colonne `mode` sim/real) |
| `WeatherClobPriceHistory` | `weather_clob_price_history` | Historique prix CLOB par bucket météo (ingestion) |
| `WeatherHistoryIngestJob` | `weather_history_ingest_jobs` | Job d'ingestion historique CLOB |
| `BacktestRun` | `backtest_runs` | Run de backtest (params, stats, fingerprint, `engineVersion`) |
| `BacktestPosition` | `backtest_positions` | Position simulée d'un run ; FK `run_id` CASCADE |
| `BacktestEquityPoint` | `backtest_equity_points` | Points d'equity d'un run |
| `BacktestExcludedTick` | `backtest_excluded_ticks` | Ticks exclus d'un run (hors plage, gap) |

## Idempotence (`idempotence/hash.ts`)

| Fonction | Clé hachée | Usage |
|---|---|---|
| `hashMoveEventId` | trader::condition::asset::type::prevSize::newSize::seq | Dédoublonnage des MoveEvents (UNIQUE en base) |
| `hashCopyOrderSignalId` | moveEventId::mode::reason::side | Un ordre par événement copié |
| `hashStrategyOrderSignalId` | positionId::mode::reason::closingAttemptSeq | Un ordre par tentative de fermeture SL/TP |
| `hashRedemptionOrderSignalId` | positionId::REDEMPTION | Une rédemption par position |
| `hashAlgoOrderSignalId` | conditionId::interval::outcome::strategyId::mode | Un ordre par signal crypto-algo et par mode |

## Pricing (`pricing/`)

**`vwap.ts` — `walkBook(levels, quantity, ascending)`** : trie le carnet (bids desc / asks asc), consomme les niveaux jusqu'à épuisement de la quantité. Retourne `{ vwap, filledQuantity, liquidityStatus: 'ok'|'partial'|'illiquid' }`.

- `triggerPnlPercent = (bidVwap − entryBidVwap)/entryBidVwap × 100` — mouvement de marché (bid vs bid d'entrée). **Garde TP** : le take-profit ne se déclenche que si `trigger ≥ 0`.
- `displayPnlPercent = (bidVwap − entryPrice)/entryPrice × 100` — affichage (« marché » UI, hors frais).
- `closurePnlPercent = (bidVwap − costBasis) / costBasis × 100` avec `costBasis = entryPrice + entryFeesRemaining / qty` — PnL clôture frais inclus. **Base unique** des sorties SL / TP / trailing (copy, crypto, weather) : SL si `closure ≤ −slPercent`, TP si `closure ≥ tpPercent` (et trigger ≥ 0), trailing sur le drawdown depuis `peakClosurePnlPercent`.
- `unrealizedPnl = (bidVwap − entryPrice) × quantity − entryFeesRemaining`.

**Spread** : écart entre le prix d'achat (ask) et le prix de revente immédiate
(bid). Un spread extrême à l'entrée peut produire une forte perte en « clôture »
alors que « marché » reste proche de 0 %. Le filtre `*MinBidToAskRatio` dans
`CopyProcessor` bloque ces entrées avant réservation.

**`fees.ts`** : frais taker Polymarket `C × (bps/10000) × p × (1−p)`, arrondi 5 décimales, plancher 0.00001.

## Risque (`risk/`)

Source de vérité config = 4 tables isolées (`GlobalConfig` / `CopyConfig` /
`CryptoConfig` / `WeatherConfig`). Getters algo-kind dans `policy.ts`
(`getCopy*` / `getCrypto*` / `getWeather*`) — plus de `pickModeValue` /
`getMode*` legacy.

- `policy.ts` : `isEntryBidAskRatioAcceptable` ; `getCopyMinBidToAskRatio` /
  `getCrypto…` / `getWeather…` ; `getCopyAllowedMarketTags` ; `evaluateSlTpTrailing`
  (ordre **SL → TP → TRAILING**, seuils en **% de la mise investie** via
  `slPercent` / `tpPercent` / `trailingPercent` ; trailing sur `peakClosurePnlPercent`).
- `exit-decision.ts` : `evaluatePreCloseExit` — fenêtre pre-close ; keep si
  `keepEnabled` et `markBid >= keepBidThreshold` ; sinon `PRE_CLOSE_LOSS` /
  `PRE_CLOSE_WIN` selon PnL. (L'ancien vocabulaire `preCloseHoldIfWinning` /
  `cryptoAlgoPreCloseWinConfidenceBid` n'existe plus.)
- `crypto-algo-exit.ts` : `resolveExitDecisionMarkPrice`,
  `resolveAlgoEntryExitParams` (percent + table d'intervalle), interval helpers.
- `crypto-algo-tunables.ts` / `crypto-algo-strategy-params.ts` / `crypto-config-api.ts`
- `weather-exit-params.ts` / `weather-config-api.ts`
- `sim-execution-tunables.ts` / `sim-mode-fields.ts`

## Sizing (`sizing/`)

- `compute.ts` : quantité copiée proportionnelle, plafonnée par `maxPositionSizeUsdc` et le solde disponible.
- `entry-sizing.ts` : orchestration triple-pass VWAP (estimation qty, ask exact, bid/ask final).
- `entry-mos.ts` / `resolve-entry-mos.ts` / `apply-entry-mos-gate.ts` : Minimum Order Size gate.
- `entry-depth-retry.ts` / `gate-algo-entry-liquidity.ts` : profondeur ask + retries (book frais).
- `enqueue-entry-signal.ts` / `resume-reserved-entry.ts` : enqueue Redis + reprise après réserve sans enqueue.

## Simulation (`simulation/accounting.ts`)

- Achat : `cashDebit = fillPrice × fillQty + fees`.
- Vente : `feeAlloc = entryFeesRemaining × (fillQty / entryQtyRemaining)` (prorata),
  `realizedPnl = proceeds − entryPrice×fillQty − exitFees − feeAlloc`,
  `cashCredit = proceeds − exitFees`.
- Rédemption : vente à payoff 0/1 sans frais de sortie.

## Marché (`market/`) — domaine métier

- `lifecycle.ts` : `isMarketSettled` (`winningTokenId` connu **ET** (`resolved` OU (`closed` ET `acceptingOrders=false`))) ; `getRedemptionPayoff` → 0|1.
- `tags.ts` : parsing slugs Gamma, whitelist, catalogue nav, enrichissement events.
- `classifier` / `market-type` : classification métier (crypto up/down, weather, etc.).

## Polymarket (`polymarket/`) — intégration API / WS / on-chain

Frontière C7 : le domaine vit dans `market/` ; `polymarket/` transporte et
réexporte (ex. `market-list.ts` réexporte `marketClassifier` et définit
`isMarketActive`). Autres modules clés : `book-freshness`, `circuit-breaker`,
`rate-limited-fetch`, `token-bucket`, `connection-manager`, `websocket-book`,
`auto-track-discovery`, `gamma-market-cache`, `market-metadata`, `clob-signature`,
`pusd-amount`, `clob-contracts`, `collateral-tokens`, `redemption`.

## Services

| Service | Responsabilité |
|---|---|
| `PollCycleService` | Diff snapshots → transitions idempotentes ; `reconcile` (1er poll sans snapshot) ; skip faux CLOSED si troncature Data API |
| `ReservationService` | Réservation transactionnelle (counts via `EntityManager`), garde COPY_OPEN anti-doublon, janitor TTL, `sumActiveReservedNotional` |
| `ExecutionService` | `claim` → `{ execution, alreadyInFlight }` ; `claimUnlessFilled` retourne `false` si une rédemption `REDEMPTION` est déjà en vol (`placing`/`partial`) — **timeout REDEMPTION `placing` > 5 min** (`REDEMPTION_PLACING_TIMEOUT_MS`) → reset `failed` puis reclaim ; `finalize` (fill VWAP, fill tardif real, plafond SELL `requestedQty`) ; `failActiveForPosition`, `loadOrphanPlacingSim` (sim : placing orphelin si position a quitté l’état attendu **ou** BUY `pending` + réservation stale/absente/expirée, seuil `SIM_BUY_PLACING_STALE_MS` = 60 s), `loadReconcilableReal`, `findReconcilableRealByClobOrderId` |
| `CopiedPositionService` | `beginClose` (seq++), `revertClose`, `markPendingResolution` / `markFailed` (UPDATE conditionnels), `loadClosingStuck`, `loadResolvable` inclut `failed` |
| `MarketResolutionService` | Détection des marchés réglés → positions `pending_resolution` |
| `MarketService` | fetch+persist métadonnées, enrichissement des positions, `saveResolution` |
| `MoveEventService` | `loadRecent` (filtré pertinence), `loadUnprocessed`, `markProcessed` batch |
| `RiskService` | Getters config isolés (`getGlobalConfig` / `getCopyConfig` / `getCryptoConfig` / `getWeatherConfig` / `getConfigForAlgo`) ; `checkKillSwitch` |
| `GlobalConfigService` / `CopyConfigService` / `CryptoConfigService` / `WeatherConfigService` | Quartet C2 — héritent de `BaseConfigService<T>` (cache TTL 5 s + `getConfig`/`updateConfig`) ; cache slot + `invalidateConfigCache()` static par sous-classe |
| `MarketPriceHistoryBackfillService` | `ensureHistorySynced` — backfill historique prix marché |
| `SimulationService` | cash, `adjustCash` transactionnel, snapshot (cash + positions mark-to-market), `reset` |
| `SimulationArchiveService` | `createSnapshot`, `listSnapshots` (filtres), `getSnapshotDetail`, `deleteAllSnapshots` |
| `WatchlistService` | CRUD (limite 20, adresses lowercase) |
| `CopiedPositionPresenter` | Enrichissement pour l'affichage (nom trader, question marché, lien) |
| `AlgoAutoTrackService` | CRUD règles auto-track (`cryptoSymbol`, `interval`) ; `loadAllEnabled`, `syncAfterMarketResolved` (découverte de nouveaux marchés après résolution) |
| `AlgoMarketSelectionService` | CRUD sélections marché (`conditionId`, `cryptoSymbol`, `interval`) ; `ensureMarketsForEnabledSelections`, `setEnabled` |
| `AlgoSurveillanceHelpers` | Helpers pour la surveillance OHLC (calcul de snapshots, normalisation) |
| `AlgoEventsService` | `loadRecent` : transforme les `AlgoSurveillanceSnapshot` en `AlgoEvent` enrichis (status, exécutions sim/real, slippage) pour l'affichage unifié dans le panneau Événements |
| `MarketPositionTickService` | `recordTick` / `recordBatch` (persistance ticks), `listByPosition` / `listByMarket` (filtres date + pagination), `purgeOlderThan` (purge batchée par 5 000 lignes via index `createdAt`) |
| `AlgoPriceTickService` | `recordTick` / `listTicks` / `deleteOlderThan` — historique prix algo pour chart API |
| `MarketPriceTickService` | `recordTick` / `listTicks` — ticks de marché par `conditionId` (graphique UI non-crypto) |
| `MarketPriceHistorySyncService` | Synchronisation de l'historique des prix de marché |
| `MarketSyncConfigService` | CRUD configuration de synchronisation des marchés |
| `RealArchiveService` | `createSnapshot`, `listSnapshots`, `getSnapshotDetail` pour les archives réelles |
| `RealPeriodArchiveService` | Archivage de clôture de période réelle |
| `RealSessionService` | Gestion des sessions de trading réel |
| `RealPortfolioService` | Calculs de portfolio réel (equity, PnL) |
| `SimulationSessionService` | Gestion des sessions de simulation **scopées par `algoKind`** |
| `SimulationResetArchiveService` | Archivage reset simulation (création session close + archivage) |
| `SimExecutionStatsService` | Statistiques d'exécution simulation (latence p50/p90, shadow fills) |
| `RiskConfigRevisionService` | Journal append-only des révisions config isolées (`configKind`) |
| `AnalysisReportService` | CRUD rapports d'analyse persistés |
| `SystemConfigService` | CRUD configuration système (clés/valeurs, catégories) |
| `ExitAttemptEventService` | `listByPosition` — journal des tentatives de sortie |
| `CryptoAlgoRuntimeStatusService` | Publication/lecture du statut runtime crypto-algo via Redis |
| `WeatherAutoTrackService` / `WeatherForecastService` / `WeatherPositionForecastService` | Auto-track, cache Open-Meteo, snapshot forecast d'entrée (voir [`../reference/weather-algo.md`](../reference/weather-algo.md)) |
| `AlgoSurveillanceService` | `findLiveMarkets`, gestion snapshots de surveillance OHLC |
| `AlgoSelectionBookAssets` | Résolution des assets de book pour les sélections algo |

## Prix mark (`positions/mark.ts`)

Priorité : marché réglé → payoff 0/1 ; sinon bid du carnet ; sinon dernier `executableBidVwap` ; sinon `entryBidVwap ?? entryPrice`. `sumOpenPositionsValue` sert au snapshot d'equity de simulation.
