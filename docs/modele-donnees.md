# Modele de donnees

La persistance repose sur **PostgreSQL** via **TypeORM** (`pg` driver). Les
entites sont declarees dans `packages/core/src/entities/` et enregistrees dans
`data-source.ts`. En production, le schema est gere par **`npm run migrate`**
(`synchronize: false` sauf dev ou `ALLOW_SYNCHRONIZE_PROD`).

## Tables (entites TypeORM)

| Entite | Table | Role |
|--------|-------|------|
| `User` | `users` | Comptes (admin seede au demarrage) |
| `WatchlistEntry` | `watchlist` | Traders surveilles et flags de copie |
| `GlobalConfig` | `global_config` | Config transversale (slippage, kill-switch, realism sim, snapshots) — API `GET/PUT /api/config/global` |
| `CopyConfig` | `copy_config` | Config copy-trading (limites, sizing, sorties, filtres) — API `GET/PUT /api/config/copy` |
| `CryptoConfig` | `crypto_config` | Config crypto-algo (sizing, SL/TP, re-entry, tunables) — API `GET/PUT /api/config/crypto` |
| `RiskConfigRevision` | `risk_config_revisions` | Journal append-only des mises à jour config (`configKind` = global/copy/crypto/weather) |
| `AnalysisReport` | `analysis_reports` | Snapshots de rapports d'analyse persistés |
| `PostEntryMidSample` | `post_entry_mid_samples` | Mid Up/Down post-entrée algo (+1s/+5s/+30s) — rétention 14 j |
| `ClobCredentials` | `clob_credentials` | Credentials CLOB/relayer chiffres (trading reel) |
| `WalletAccount` | `wallet_accounts` | Comptes/wallets de depot Polymarket |
| `TraderSnapshot` | `trader_snapshots` | Dernier etat connu des positions d'un trader |
| `TraderSnapshotSeq` | `trader_snapshot_seq` | Compteur de sequence de polling par trader |
| `MoveEventEntity` | `move_events` | Mouvements detectes (ouverture/inc/dec/cloture) |
| `CopiedPosition` | `copied_positions` | Positions repliquees par Polywatch |
| `Execution` | `executions` | Ordres executes (claim -> fill) |
| `PositionReservation` | `position_reservations` | Reservations de capital (TTL 180 s) |
| `SimulationBalance` | `simulation_balances` | Solde pUSD sim **par `algoKind`** (`crypto` / `weather` / `copy`, unique) + `session_started_at`, `current_session_id` |
| `SimulationSession` | `simulation_sessions` | Sessions de simulation entre deux resets (voir [`snapshots-simulation.md`](./snapshots-simulation.md)) |
| `RealSession` | `real_sessions` | Periodes de trading reel entre deux clotures (voir [`snapshots-real.md`](./snapshots-real.md)) |
| `RealSessionState` | `real_session_state` | Pointeur singleton vers la periode active (sans montant wallet) |
| `RealStateSnapshot` | `real_state_snapshots` | Archives d'etat reel (sources `manual`, `auto`, `rotate`) |
| `RealArchivePosition` | `real_archive_positions` | Positions reelles fermees archivees par periode |
| `RealArchiveExecution` | `real_archive_executions` | Executions reelles archivees |
| `RealArchiveExitAttempt` | `real_archive_exit_attempts` | Tentatives de sortie reelles archivees |
| `SimArchivePosition` | `sim_archive_positions` | Positions sim archivees par session |
| `SimArchiveExecution` | `sim_archive_executions` | Executions sim archivees |
| `SimArchiveExitAttempt` | `sim_archive_exit_attempts` | Tentatives de sortie sim archivees |
| `SimArchiveSurveillance` | `sim_archive_surveillance` | Surveillance algo archivee |
| `SimArchivePriceCandle` | `sim_archive_price_candles` | Bougies 1 min agreegees (ticks) |
| `SimulationStateSnapshot` | `simulation_state_snapshots` | Archives d'etat simulation (voir [`snapshots-simulation.md`](./snapshots-simulation.md)) |
| `Market` | `markets` | Metadonnees marche + cycle de vie |
| `AlgoMarketSelection` | `algo_market_selections` | Marches crypto-algo selectionnes pour la surveillance |
| `AlgoAutoTrackRule` | `algo_auto_track_rules` | Regles d'auto-track actives pour la decouverte de marches |
| `AlgoSurveillanceSnapshot` | `algo_surveillance_snapshots` | Instantanes de surveillance (open/close) pour l'analyse des strategies |
| `AlgoPriceTick` | `algo_price_ticks` | Historique prix UP/DOWN 1 Hz pendant surveillance algo (chart API) |
| `IntegrationSettings` | `integration_settings` | Parametres d'integrations tierces (ex: Polygonscan chiffre) |
| `MarketPositionTick` | `market_position_ticks` | Ticks de marche (prix/order book) pour positions copy/weather ouvertes — pas crypto-algo (`ALGO_*` → `algo_price_ticks`) |
| `MarketPriceTick` | `market_price_ticks` | Ticks de marche par `conditionId` (timer 1s, independant des positions) pour graphique UI non-crypto |
| `SystemConfig` | `system_config` | Configuration systeme (cles/valeurs, categories) |
| `ExitAttemptEvent` | `exit_attempt_events` | Journal des tentatives de sortie (SL/TP/PRE_CLOSE) avec mark price et raison de blocage |
| `ClobLatencySample` | `clob_latency_samples` | Echantillons de latence d'execution CLOB (RTT, timestamp) pour le calibrage simulation |
| `ShadowFill` | `shadow_fills` | Fills simules (shadow logging) pour l'audit de realisme d'execution |
| `MarketPriceHistorySync` | `market_price_history_sync` | Registre de synchronisation de l'historique des prix de marche |
| `MarketSyncConfig` | `market_sync_config` | Configuration de synchronisation des marches (intervalles, backoff, concurrency) |
| `E2eTestRun` | `e2e_test_runs` | Runs de tests E2E (suite, statut, duree, logs, triggeredBy, errorMessage) |
| `E2eRunPosition` | `e2e_run_positions` | Positions d'un run E2E (conditionId, cryptoSymbol, interval, prix d'entree, PnL, statut) |
| `WeatherMarketSelection` | `weather_market_selections` | **Supprimé** — remplacé par `WeatherAutoTrackRule` (city-first) |
| `WeatherAutoTrackRule` | `weather_auto_track_rules` | **Sélection active** : ville surveillée (`city`, `metric=highest_temp`, `lookAheadDays`, `mode=city_follow`) |
| `WeatherConfig` | `weather_config` | Config weather-algo (edge, switch mode, hysteresis, throttle, capital sim, **toggles/rétention recording**…) — API `GET/PUT /api/config/weather` |
| `WeatherForecastCache` | `weather_forecast_cache` | Cache Open-Meteo upsert — **actif** |
| `WeatherPositionForecast` | `weather_position_forecasts` | Snapshot forecast à l'ouverture — **actif** (index unique `copied_position_id`). Colonnes `entry_bucket_comparison` + `entry_bucket_bounds` pour bucket-exit. |
| `WeatherForecastHistory` | `weather_forecast_history` | Historique append-only des fetchs Open-Meteo (backtest) — `fetchedAt` |
| `WeatherMarketSnapshot` | `weather_market_snapshots` | Snapshot marché par cycle × ville × date — `recordedAt` |
| `WeatherBucketTick` | `weather_bucket_ticks` | Prix YES/NO d’un bucket actif ; FK `snapshot_id` **ON DELETE CASCADE** |
| `WeatherEvaluationLog` | `weather_evaluation_log` | Journal signal/abstain ; FK `snapshot_id` **ON DELETE SET NULL** |
| `WeatherClobPriceHistory` | `weather_clob_price_history` | Historique prix CLOB Polymarket par bucket météo (ingestion manuelle) — index unique `(condition_id, side, recorded_at)` ; colonnes `city`, `target_date`, `metric`, `bucket_*`, `token_id`, `price`, `fidelity_minutes`, `ingest_job_id` |
| `WeatherHistoryIngestJob` | `weather_history_ingest_jobs` | Job d'ingestion historique (statut, progression `markets_done/total`, `points_upserted`, `markets_empty`, `error_message`) |
| `BacktestRun` | `backtest_runs` | Run de backtest (job) : cycle de vie, params, stats, warnings, fingerprint config, plage de données |
| `BacktestPosition` | `backtest_positions` | Position simulée d'un run backtest ; FK `run_id` **ON DELETE CASCADE** |
| `BacktestEquityPoint` | `backtest_equity_points` | Points d'equity (courbe) d'un run backtest ; FK `run_id` **ON DELETE CASCADE** |

## Relations conceptuelles

```
User                       (auth)
WatchlistEntry 1---* CopiedPosition *---1 Market (condition_id)
                          |
CopiedPosition 1---* Execution
CopiedPosition 1---1 PositionReservation (transitoire, COPY_OPEN/INCREASE)
TraderSnapshot ---(seq)--- TraderSnapshotSeq
MoveEventEntity ---> (declenche) CopiedPosition
```

> Les liens ne sont pas des cles etrangeres TypeORM mais des references par
> identifiants (`watchlistId`, `conditionId`, `assetId`, `copiedPositionId`,
> `orderSignalId`).

## Detail des entites cles

### `WatchlistEntry` (`watchlist`)
Trader surveille. `traderAddress`, `nickname`, `active`, `simEnabled`,
`realEnabled`. Les flags determinent quels modes le `CopyProcessor` applique.

### Config isolées (post-split RiskConfig)

> **Legacy** : la table monolithique `risk_config` / entité `RiskConfig` a été
> **purgée** (migration `0088` + Phase F). Source de vérité runtime =
> 4 singletons TypeORM + getters `RiskService.get*Config`.

| Entité | Table | Périmètre | API |
|--------|-------|-----------|-----|
| `GlobalConfig` | `global_config` | Slippage, `realTradingEnabled`, realism sim, auto-snapshots sim/real | `/api/config/global` |
| `CopyConfig` | `copy_config` | Limites/sizing/sorties/filtres copy-trading (paires sim/real), polling MoveDetector | `/api/config/copy` |
| `CryptoConfig` | `crypto_config` | Enable/stratégies, sizing, SL/TP/trailing/pre-close, re-entry, SL quota, curve/band, tunables | `/api/config/crypto` |
| `WeatherConfig` | `weather_config` | Edge, switch mode, hysteresis, throttle, capital sim weather | `/api/config/weather` |

Détail des champs et défauts : entités `packages/core/src/entities/*Config.ts`,
seed `packages/core/src/seed/defaults.ts`, et [`configuration.md`](./configuration.md).
Journal des mises à jour : `RiskConfigRevision` (`configKind` ∈ global/copy/crypto/weather).

### `PostEntryMidSample` (`post_entry_mid_samples`)
Échantillons mid Up/Down après fill `ALGO_OPEN` confirmé (`offsetMs` 1000/5000/30000).
Colonnes : `conditionId`, `outcome`, `positionId`, `filledAtMs`, `upMid`/`downMid`,
`sampledAtMs`. Rétention 14 j (janitor crypto-algo). Voir [`crypto-algo.md`](./crypto-algo.md).

### `SimulationStateSnapshot` (`simulation_state_snapshots`)

Archive immuable de l'etat simulation. Colonnes agreegees (equity, PnL, compteurs,
`source`, `label`, `session_id`, **`algo_kind`**) + JSON (`config_json`, `traders_json`,
`positions_json`, `executions_json`, `exit_attempts_json`, `move_events_json`,
`decision_summary_json`). Sources : `manual`, `auto`, `reset`.
Service : `SimulationArchiveService` (create / list filtrés par `algoKind`).

### `SimulationSession` (`simulation_sessions`)

Regroupe les snapshots d'une course de simulation entre deux resets **d'un même
`algoKind`**. Champs : `algo_kind` (`crypto` | `weather` | `copy`), `status`
(`active` | `closed`), `started_at`, `ended_at`, `label`, `notes`, agregats
(`snapshot_count`, `peak_equity`, `trough_equity`, `ending_equity`,
`ending_session_pnl`, `baseline_capital`, `archive_summary_json`).
**Une seule session `active` par `algo_kind`** (unique partiel).
Service : `SimulationSessionService` ; archivage reset :
`SimulationResetArchiveService` (purge / archive scopées au kind).

### `RealSession` (`real_sessions`)

Regroupe les snapshots d'une **periode** reelle entre deux clotures. Meme forme
que `SimulationSession` ; `baseline_capital` = equity observationnelle au debut
de periode. Service : `RealSessionService` ; archivage cloture :
`RealPeriodArchiveService`.

### `RealStateSnapshot` (`real_state_snapshots`)

Archive immuable de l'etat reel. Sources : `manual`, `auto`, `rotate`.
Service : `RealArchiveService`. Voir [`snapshots-real.md`](./snapshots-real.md).

### `TraderSnapshot` (`trader_snapshots`)
Dernier etat de chaque position d'un trader, contrainte
`UNIQUE(traderAddress, conditionId, assetId)`. Compare au snapshot entrant pour
calculer les transitions. `snapshotSeq` versionne le cycle.

### `MoveEventEntity` (`move_events`)
Cle primaire = **id deterministe** (`hashMoveEventId`) garantissant
l'idempotence. `eventType` dans `OPENED|INCREASED|DECREASED|CLOSED`,
`previousTraderSize`/`traderSize`, `processed` (consomme par le worker).

### `CopiedPosition` (`copied_positions`)
Coeur du domaine. Champs notables :
- Identite : `watchlistId`, `conditionId`, `assetId`, `outcome`, `side`, `mode`.
- Entree : `quantity`, `entryPrice`, `entryBidVwap`, `entryFees`,
  `entryQuantityRemaining`, `entryFeesRemaining`.
- Valorisation : `executableBidVwap`, `unrealizedPnl`, `realizedPnl`,
  `peakClosurePnlPercent`, `peakBidVwap` (pic du bid pour trailing), `liquidityStatus`.
- Sorties : `slBidPoints`, `tpBidPoints`, `trailingBidPoints`,
  `trailingActivationBidPoints`.
- Cycle : `status`, `openedAt`, `closedAt`, `closeReason`, `closingReason`
  (raison de sortie en cours, renseignee par `beginClose`), `increaseCount`,
  `closingAttemptSeq`.
- **`closeReason` (annulation / non-execution algo)** : `reservation_expired` (janitor TTL),
  `reservation_released` (release pipeline, reset sim avec purge Redis, ou purge manuelle via
  `flush-redis-queues --release-reservations`). Positions `cancelled` sans raison
  historiques : script `tools/backfill-close-reason-reservation-released.ts`.
- **Blocage d'exit** : `exitBlockedUntil` (timestamp jusqu'auquel les sorties sont bloques).
- **Bids cloturables** : `lastCloseableBidVwap` (dernier VWAP de bid cloturable connu),
  `lastCloseableBidAt` (timestamp associe).

Statuts (`CopiedPositionStatus`) :
`pending -> open -> closing -> closed`, plus `pending_resolution`, `failed`,
`cancelled`.

### `Execution` (`executions`)
Une ligne par ordre. `orderSignalId` **unique** (idempotence du claim). Contient
`mode`, `side`, `orderType`, `requestedQty`, `fillPrice`, `fillQuantity`
(plafonne a `requestedQty` pour les SELL), `fees`, `realizedPnl`, `status`
(`placing`, `partial`, `filled`, `failed`, ...), `reason`, `txHash`,
`clobOrderId`, `error`, **`referenceVwap`** (VWAP de reference au moment de l'ordre, nullable).

Statuts reconciliables (real) : `placing`, `partial`, `failed` recent avec
`clobOrderId` et sans fill — voir `loadReconcilableReal()`.

### `PositionReservation` (`position_reservations`)
Reservation transitoire de capital creee pour `COPY_OPEN`/`COPY_INCREASE`.
`reservedNotionalUsdc`, `expiresAt` (TTL 180 s). Nettoyee par le
`ReservationJanitor`.

### `Market` (`markets`)
Metadonnees et cycle de vie d'un marche : `question`, `slug`, `eventSlug`, `category`,
`icon`, `endDate`, `tokenIdYes`/`tokenIdNo`, `negRisk`, `feeRate`, `feeExponent`
(frais CLOB dynamiques), `marketType` (type de marche Polymarket), et drapeaux de cycle
(`active`, `resolved`, `closed`, `acceptingOrders`, `winningTokenId`).
Champs utilises par le filtre de copie : `category` (Gamma), `tagSlugs`
(JSON, slugs agreeges depuis le market et ses events lies — cache pour
`MarketService.resolveTagSlugs`).

### `ClobCredentials` / `WalletAccount`
Donnees sensibles du trading reel. Les champs `*_enc` sont **chiffres**
(`MASTER_ENCRYPTION_KEY`, voir `packages/backend/src/crypto/encryption.ts`).
`WalletAccount` decrit les wallets de depot (`depositAddress`, `funderAddress`,
`signerPkEnc`, `signatureType`, `isPrimary`).

### `SimulationBalance` (`simulation_balances`)
Solde virtuel `pUSD` **par périmètre** `algo_kind` (`crypto` | `weather` | `copy`,
contrainte unique). Initialise au seed (3 lignes) ; reinitialisable via
`POST /api/simulation-balance/reset` avec `algoKind`. Champs : `amount`,
`baseline_capital`, `session_started_at`, `current_session_id`.

### `RiskConfigRevision` (`risk_config_revisions`)
Journal append-only des mises a jour `risk_config` (migration `0047`). Champs :
`source` (`api` | `report_apply` | `system`), `patch_json`, `config_json` (presentation
API), `config_fingerprint` (hash tunables `crypto_algo_*`), `created_at`. Cree a chaque
`PUT /api/risk-config`.

### `AnalysisReport` (`analysis_reports`)
Snapshots de rapports d'analyse persistes (hub **Rapports**). Champs : `type`
(`crypto_algo_optimize`, ...), `label`, `note`, `params_json` (perimetre + fenetre),
`payload_json` (sortie builder fgee), `config_fingerprint`, `scope_summary`,
`positions_closed_count`, `positions_total_count`, `created_at`. Retention : 50 lignes /
90 jours. Voir [`rapports-analyse.md`](./rapports-analyse.md).

### `AlgoMarketSelection` (`algo_market_selections`)
Marches explicitement selectionnes par l'utilisateur pour etre surveilles et evalues par le module de trading algorithmique `crypto-algo`.

### `AlgoAutoTrackRule` (`algo_auto_track_rules`)
Regles de decouverte automatique (auto-track) de nouveaux marches en fonction de la cryptomonnaie cible (`cryptoSymbol`) et de l'intervalle (`interval`).

### `AlgoSurveillanceSnapshot` (`algo_surveillance_snapshots`)
Instantanes de surveillance enregistrant les prix UP/DOWN et le statut lors de l'ouverture
et de la resolution/cloture du marche. Depuis la migration snapshot v2, stocke aussi
`positions_json` + `positions_captured_at` pour figer les positions au moment du close
(voir [`snapshots-simulation.md`](./snapshots-simulation.md#algo-surveillance-positions-figees)).

### `AlgoPriceTick` (`algo_price_ticks`)

Ticks enregistres par `PriceTickRecorder` (crypto-algo) a **1 Hz** pendant la
surveillance active d'un marche :

- `conditionId`, `upPrice`, `downPrice`, `recordedAt`
- Metriques enrichies :
  - **Prix** : `upBid`, `upAsk`, `downBid`, `downAsk`, `upAskVwap`, `downAskVwap`
  - **Spread** : `upSpreadPct`, `downSpreadPct`, `priceGap`
  - **Liquidite** : `upLiquidityStatus`, `downLiquidityStatus`, `bookStalenessMs`, `wsHealthy`
  - **Taille** : `upBidSize`, `upAskSize`, `downBidSize`, `downAskSize`
  - **Dernier trade** : `upLastTradePrice`, `downLastTradePrice`, `upLastTradeSize`, `downLastTradeSize`
  - **Delta** : `upDelta1s`, `downDelta1s` (variation sur 1 seconde)
  - **Positions** : `openPositionsCount`, `openExposureUsd`, `unrealizedPnl`
  - **Signal** : `lastSignalOutcome`, `lastSignalConfidence`, `lastSignalStrategyId`, `signalAgeMs`, `lastAbstainReason`
  - **Cycle** : `secondsUntilEnd`

Purge automatique selon `cryptoAlgoTickRetentionHours` (defaut 24 h). Consomme par `GET /api/algo/market-chart/:conditionId`.

### `IntegrationSettings` (`integration_settings`)
Singleton stockant les cles d'integration chiffrees pour les APIs externes (comme la cle API Polygonscan).

> **Reference metriques de marche** : inventaire complet (donnees persistees vs live,
> comparaison CLOB/APIs Polymarket, lacunes, roadmap) —
> [`metriques-marche.md`](./metriques-marche.md).

### `MarketPositionTick` (`market_position_ticks`)
Tick de carnet d'ordres persiste par le worker (`MarketTickRecorder`) a chaque book update
throttle a 500 ms par asset, **uniquement pour les assets ayant au moins une position
copy ou weather ouverte**. Une ligne est inseree par position eligible sur l'asset.

**Exclusion crypto-algo** : les positions dont `reason` commence par `ALGO_` ne sont
pas enregistrees ici. Leur serie BBO+VWAP+signal vit dans `algo_price_ticks`
(`PriceTickRecorder` du process crypto-algo, ~1 Hz) — ecrire les deux serait redondant.
Filtre : `isAlgoPositionReason` dans `MarketTickRecorder`.

- Champs : `copiedPositionId`, `conditionId`, `assetId`, `outcome`, `bestBid`, `bestAsk`,
  `midPrice`, `spread`, `spreadPercent`, `executableBidVwap` / `executableAskVwap` (VWAP
  pour une quantite de reference `MARKET_TICK_REF_QTY=100`, nullable), `lastTradePrice`
  (nullable), `createdAt`.
- Index : `copiedPositionId`, `(conditionId, createdAt)`, `(assetId, createdAt)`, et
  `createdAt` seul (ajoute pour optimiser la purge).
- Retention : 30 jours par defaut (`MARKET_TICK_RETENTION_DAYS`), purge horaire par
  batches de 5 000 lignes (`MarketPositionTickService.purgeOlderThan`) — l'index
  `createdAt` permet un `SELECT id ... WHERE createdAt < :cutoff LIMIT 5000` cible sans
  scan full-table, et le `DELETE ... WHERE id IN (...)` par batch limite la duree des
  locks pour ne pas bloquer les INSERT concurrents du recorder.
- Expose via `GET /api/copied-positions/:id/ticks` et `GET /api/markets/:conditionId/ticks`.

### `MarketPriceTick` (`market_price_ticks`)
Tick de marche persiste par le worker (`MarketPriceTickRecorder`) a **1 Hz** (timer
fixe), **par `conditionId` independamment des positions ouvertes**. Equivalent
non-crypto de `AlgoPriceTick`.

- Champs : `conditionId`, `assetId` (nullable), `bestBid`, `bestAsk`, `midPrice`,
  `spread`, `spreadPercent`, `executableBidVwap` / `executableAskVwap` (nullable),
  `lastTradePrice` (nullable), `recordedAt`, `createdAt`.
- Index : `(conditionId, recordedAt)`, `recordedAt`.
- Consomme par `GET /api/market-chart/:conditionId` (graphique UI non-crypto).
- Purge : non implementee pour l'instant (a ajouter dans une prochaine iteration).

### `SystemConfig` (`system_config`)
Configuration systeme cle/valeur avec categorisation. Utilisee pour les parametres
d'infrastructure (timeouts, thresholds, feature flags) qui ne sont pas lies au risque
ou au trading. Exposee via `GET /api/system-config`, `GET /api/system-config/:key`,
`GET /api/system-config/by-category/:category`, UI **Config systeme**.

Exemples de cles worker :
- timings / caches / circuit breaker (`worker.*`) — overlays boot via `initWorkerConfigCache`
- `worker.log.book_404_errors` (`false` par defaut) — si `true`, logue les warnings
  CLOB book HTTP 404 (souvent transitoires) ; sinon silences via `book-error-log.ts`

### `ExitAttemptEvent` (`exit_attempt_events`)
Journal d'audit des tentatives de sortie. Enregistre chaque evaluation de sortie
(SL/TP/PRE_CLOSE) avec le mark price, la raison, et le motif de blocage
eventuel. Colonne `mode` (`sim` | `real`) pour filtrer le journal archive dans les
snapshots simulation. Permet le debogage des sorties manquees via le `MarketChartDebugPanel`.

### `ClobLatencySample` (`clob_latency_samples`)
Echantillons de latence RTT (Round-Trip Time) des appels a l'API CLOB Polymarket.
Utilises par le `LatencyCalibrator` pour ajuster le realisme des executions simulees.
Purge automatique periodique.

### `ShadowFill` (`shadow_fills`)
Enregistrement des fills simules (shadow logging) pour l'audit de realisme
d'execution. Permet de comparer les prix simules vs les prix reels CLOB.

### `MarketPriceHistorySync` (`market_price_history_sync`)
Registre de suivi de la synchronisation de l'historique des prix de marche.
Stocke l'etat de la synchro pour chaque marche (dernier tick synchronise,
statut, erreur).

### `MarketSyncConfig` (`market_sync_config`)
Configuration de la synchronisation des marches : intervalles de polling,
backoff en cas d'erreur, limites de concurrence. Exposee via
`GET/PUT /api/market-sync-config`.

### `BacktestRun` / `BacktestPosition` / `BacktestEquityPoint`

Tables dédiées au moteur de backtest weather (migration `AddBacktestTables1700000000101`).
Service : `BacktestRunService`. Doc : [`backtest.md`](./backtest.md).

**`backtest_runs`** — job de replay :
- Cycle de vie : `queued` → `running` → `completed` | `failed` | `cancelled`
- `params_json` (plage, mode, villes, capital…), `config_snapshot_json`, `config_fingerprint`
- `engine_version` (semver moteur, ex. `0.2.0` via `BACKTEST_ENGINE_VERSION`)
- `stats_json` (PnL, win rate, `profitFactor` **null = +∞**, max drawdown, `byExitReason`, `byCity`…), `fidelity_warnings_json`
- `data_range_from` / `data_range_to` (plage réellement couverte par les events)
- `error` si `failed` (exception, `timeout`, `backend_restart`)

**`backtest_positions`** — positions simulées (FK `run_id` ON DELETE CASCADE) :
- Entrée/sortie, prix, PnL, fees, `entry_reason`, `exit_reason`
  (`SL`/`TP`/`TRAILING`/`RESOLUTION`/`KILL_SWITCH`/`WEATHER_*`…),
  `meta_json` (edge, bucket, seuils SL/TP résolus à l’entrée…)
- Positions encore ouvertes en fin de run : `exit_price` / `exit_at` / `pnl` = `null`

**`backtest_equity_points`** — courbe d'equity (~1 point/min de temps rejoué) :
- Colonne / champ API : `t` (timestamp ISO), `equity`, `cash`, `open_positions`
- L'UI chart utilise `t` comme axe X (pas un index)

## Files Redis (etat hors-PostgreSQL)

| Cle | Type | Producteur -> Consommateur |
|-----|------|---------------------------|
| `move-events` | liste | `MoveDetector` -> `CopyProcessor` (**interne** `@polywatch/copy-trading`) |
| `order-signals` | liste | `CopyProcessor` (copy-trading) -> `Executor` A (worker) |
| `algo-order-signals` | liste | crypto-algo -> `Executor` (worker) |
| `close-signals` | liste | `StrategyProcessing` / closes manuels -> `Executor` B |
| `execution-results` | liste | `Executor` -> `ResultsConsumer` |
| `<name>:processing` | liste | tampon de traitement (reliable queue) |
| `<name>:dead` | liste | *dead letter* apres `MAX_RETRIES` |
| `config-changed` | pub/sub | Backend -> worker / copy-trading / crypto-algo |
| `backend-ready` | pub/sub + cle TTL | Backend -> services (signal boot pret, cle `backend-ready` EX 60 s) |
| `heartbeat` | pub/sub | worker + copy-trading + crypto-algo (battement 30 s) |
| `worker:heartbeat` | cle SET EX 60 | liveness worker (`/api/system/overview`) |
| `copy-trading:heartbeat` | cle SET EX 60 | liveness copy-trading |
| `crypto-algo:heartbeat` | cle SET EX 60 | liveness crypto-algo |

## Donnees de seed (`seedDefaults`)

Au premier demarrage du backend :
- Utilisateur admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, hash bcrypt).
- `GlobalConfig` / `CopyConfig` / `CryptoConfig` / `WeatherConfig` par defaut
  (valeurs des decorateurs `@Column`, seed `seed/defaults.ts`).
- `SimulationBalance` pUSD = `DEFAULT_SIM_BALANCE` (par `algoKind`).
