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
| `RiskConfig` | `risk_config` | Configuration globale du risque/sizing/sorties (singleton) |
| `ClobCredentials` | `clob_credentials` | Credentials CLOB/relayer chiffres (trading reel) |
| `WalletAccount` | `wallet_accounts` | Comptes/wallets de depot Polymarket |
| `TraderSnapshot` | `trader_snapshots` | Dernier etat connu des positions d'un trader |
| `TraderSnapshotSeq` | `trader_snapshot_seq` | Compteur de sequence de polling par trader |
| `MoveEventEntity` | `move_events` | Mouvements detectes (ouverture/inc/dec/cloture) |
| `CopiedPosition` | `copied_positions` | Positions repliquees par Polywatch |
| `Execution` | `executions` | Ordres executes (claim -> fill) |
| `PositionReservation` | `position_reservations` | Reservations de capital (TTL 180 s) |
| `SimulationBalance` | `simulation_balances` | Solde pUSD du mode simulation (`session_started_at`, `current_session_id`) |
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
| `MarketPositionTick` | `market_position_ticks` | Ticks de marche (prix/order book) persistes pour les assets avec positions ouvertes |
| `MarketPriceTick` | `market_price_ticks` | Ticks de marche par `conditionId` (timer 1s, independant des positions) pour graphique UI non-crypto |
| `SystemConfig` | `system_config` | Configuration systeme (cles/valeurs, categories) |
| `ExitAttemptEvent` | `exit_attempt_events` | Journal des tentatives de sortie (SL/TP/PRE_CLOSE) avec mark price et raison de blocage |
| `ClobLatencySample` | `clob_latency_samples` | Echantillons de latence d'execution CLOB (RTT, timestamp) pour le calibrage simulation |
| `ShadowFill` | `shadow_fills` | Fills simules (shadow logging) pour l'audit de realisme d'execution |
| `MarketPriceHistorySync` | `market_price_history_sync` | Registre de synchronisation de l'historique des prix de marche |
| `MarketSyncConfig` | `market_sync_config` | Configuration de synchronisation des marches (intervalles, backoff, concurrency) |
| `E2eTestRun` | `e2e_test_runs` | Runs de tests E2E (suite, statut, duree, logs, triggeredBy, errorMessage) |
| `E2eRunPosition` | `e2e_run_positions` | Positions d'un run E2E (conditionId, cryptoSymbol, interval, prix d'entree, PnL, statut) |
| `WeatherMarketSelection` | `weather_market_selections` | Marchés météo sélectionnés pour le trading weather-algo (conditionId, city, metric, targetValue, eventSlug) — **actif** |
| `WeatherAutoTrackRule` | `weather_auto_track_rules` | Règles auto-track (city, metric, lookAheadDays, mode) — sync périodique vers sélections (expand) ou sélection à runtime (city_follow) |
| `WeatherForecastCache` | `weather_forecast_cache` | Cache Open-Meteo — **actif** |
| `WeatherPositionForecast` | `weather_position_forecasts` | Snapshot forecast à l'ouverture — **actif** (index unique `copied_position_id`). Colonnes `entry_bucket_comparison` + `entry_bucket_bounds` pour le mode city-follow. |

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

### `RiskConfig` (`risk_config`)
Singleton de configuration. Couvre :
- **Limites** par mode (`sim*` / `real*`) : `simMaxOpenPositions`/`realMaxOpenPositions`,
  `simMaxExposureUsdc`/`realMaxExposureUsdc`, `simMaxDailyLossUsdc`/`realMaxDailyLossUsdc`,
  `simMaxPositionSizeUsdc`/`realMaxPositionSizeUsdc`, `maxSlippagePercent`, `exitSlippageGuardPercent`.
- **Limites globales résiduelles** : `maxSlippagePercent`, `exitSlippageGuardPercent`
  (appliqués aux deux modes, non surchargés par mode).
- **Entree — liquidite** par mode : `simMinBidToAskRatio`, `realMinBidToAskRatio`
  (ratio bid VWAP / ask VWAP minimum pour `COPY_OPEN` / `COPY_INCREASE` ; `0` =
  desactive, defaut `0.9`).
- **Filtre momentum** par mode : `simMomentumFilterEnabled`, `realMomentumFilterEnabled`
  (refuse la copie si le ask VWAP est inferieur au prix moyen du trader — position deja
  sous l'eau). Fails open si le prix moyen est indisponible.
- **Activation reel** : `realTradingEnabled`, `killSwitchAction`, `simKillSwitchAction`,
  `realKillSwitchAction`.
- **Sizing copy trading** par mode (`sim*` / `real*`) : `sizingMode`
  (`fixed_ratio` | `fixed_usdc` | `fixed_shares` | `proportional_capital` | `kelly_fractional` | `risk_based`),
  `copyRatio`, `entryUsdcAmount`, `entryShareCount`, `simInitialCapital`, `kellyFraction`, `riskBudgetUsdc`,
  `defaultWinProbability`.
- **Sizing crypto-algo** : `cryptoAlgoSizingMode` (`fixed_usdc` | `fixed_shares`),
  `cryptoAlgoEntryUsdcAmount`, `cryptoAlgoEntryShareCount`.
- **Signal score sizing** : `simSignalScoreSizingEnabled`, `realSignalScoreSizingEnabled`
  (ajuste la taille d'entree selon un score de qualite du signal).
- **Sorties** par mode : `slBidPoints`, `tpBidPoints`, `slEnabled`, `tpEnabled`, `trailingEnabled`,
  `trailingBidPoints`, `trailingActivationBidPoints`, `minTimeToClose`.
- **Pre-cloture** par mode : `preCloseEnabled`, `preCloseSeconds`, `preCloseKeepEnabled`,
  `preCloseKeepBidThreshold` (si keepEnabled et bid >= seuil, la position reste ouverte
  jusqu'a la resolution).
- **Copie** : `copyIncreaseEnabled`, `copyDecreaseEnabled` (global),
  `simCopyIncreaseEnabled`, `realCopyIncreaseEnabled`, `simCopyDecreaseEnabled`,
  `realCopyDecreaseEnabled`, `maxIncreasesPerPosition` (global),
  `simMaxIncreasesPerPosition`, `realMaxIncreasesPerPosition`.
- **Proximite SL** par mode : `simCopyIncreaseSlProximityEnabled`,
  `realCopyIncreaseSlProximityEnabled`, `simCopyIncreaseSlProximityPercent`,
  `realCopyIncreaseSlProximityPercent` (bloque l'augmentation si la position est
  deja proche du SL).
- **Filtre marche** par mode : `simAllowedMarketTags`, `realAllowedMarketTags`
  (JSON `string[]` de slugs Gamma ; `[]` = pas de filtre). Applique par le
  `CopyProcessor` sur les entrees (`OPENED` / `COPY_INCREASE`) uniquement.
- **Snapshots simulation** : `simAutoSnapshotEnabled`, `simAutoSnapshotIntervalSeconds`
  (intervalle min 60 s), `simAutoSnapshotEmptySession` (snapshot config-only sur session vide),
  `simSnapshotDecisionWindowHours` (fenetre journal decisionnel, defaut 24 h),
  `simSnapshotMaxCount`, `simSnapshotRetentionDays`.
  Voir [`snapshots-simulation.md`](./snapshots-simulation.md).
- **Snapshots reel** : `realAutoSnapshotEnabled`, `realAutoSnapshotIntervalSeconds`,
  `realSnapshotDecisionWindowHours`, `realSnapshotMaxCount`, `realSnapshotRetentionDays`.
  Voir [`snapshots-real.md`](./snapshots-real.md).
- **Polling** : `moveDetectorIntervalMs` (intervalle du detecteur de mouvements,
  defaut 2000 ms).
- **Crypto-algo SL quota** : `cryptoAlgoSlQuotaEnabled` (activation, defaut `false`),
  `cryptoAlgoSlQuotaPerMarket` (max sorties SL declenchees avant blocage, defaut `1`),
  `cryptoAlgoSlQuotaCacheTtlSeconds` (TTL cache compteur, defaut `30` s).
  Comptage des `beginClose(SL)` via `copied_positions.closing_reason` ; max 1 position
  algo `open`/`closing` par `condition_id` quand active.
- **Crypto-algo trailing** : `cryptoAlgoTrailingBidPoints`, `cryptoAlgoTrailingActivationBidPoints`
  (overrides nullables, defaults par intervalle).
- **Crypto-algo pre-close** : `cryptoAlgoPreCloseEnabled`, `cryptoAlgoPreCloseSeconds`,
  `cryptoAlgoPreCloseKeepEnabled`, `cryptoAlgoPreCloseKeepBidThreshold`
  (overrides nullables, heritent du mode).
- **Crypto-algo SL/TP/trailing toggles** : `cryptoAlgoSlEnabled`, `cryptoAlgoTpEnabled`,
  `cryptoAlgoTrailingEnabled` (master toggles, defaut `true`).
- **Crypto-algo SL/TP bid points** : `cryptoAlgoSlBidPoints`, `cryptoAlgoTpBidPoints`
  (overrides nullables, bid absolu pour marchés binaires).
- **Crypto-algo re-entry** : `cryptoAlgoReentryWindowMs` (fenêtre throttle par conditionId:outcome),
  `cryptoAlgoMaxEntriesPerWindow` (max enqueues par fenêtre).
- **Crypto-algo entry price band** : `cryptoAlgoEntryPriceMin` (defaut 0.50),
  `cryptoAlgoEntryPriceMax` (defaut 0.80), `cryptoAlgoEntryPriceBandEnabled` (defaut `true`).
- **Crypto-algo curve filter** : `cryptoAlgoCurveFilterEnabled` (defaut `false`),
  `cryptoAlgoCurveLookbackMs` (defaut 10000, max 60000), `cryptoAlgoCurveMinDelta` (defaut 0.01).
- **Crypto-algo sizing** : `cryptoAlgoSizingMode` (`fixed_usdc` | `fixed_shares`),
  `cryptoAlgoEntryUsdcAmount` (defaut 10), `cryptoAlgoEntryShareCount` (nullable).
- **Crypto-algo tunables stratégie** : `cryptoAlgoBaseThreshold` (defaut 0.55),
  `cryptoAlgoSpreadAdjustmentFactor` (defaut 0.5), `cryptoAlgoMinSpreadAbsForAdjustment` (defaut 0.01),
  `cryptoAlgoMaxSpreadAbs` (defaut 0.02), `cryptoAlgoPriceSumTolerance` (defaut 0.02),
  `cryptoAlgoWarnPriceDeviation` (defaut 0.05), `cryptoAlgoMaxBookAgeMs` (defaut 15000),
  `cryptoAlgoGammaCacheTtlShortMs` (defaut 10000), `cryptoAlgoGammaCacheTtlDefaultMs` (defaut 30000),
  `cryptoAlgoGammaStaleOnErrorFactor` (defaut 2), `cryptoAlgoWsDebounceMs` (defaut 5000),
  `cryptoAlgoPollMs` (defaut 30000), `cryptoAlgoTickIntervalMs` (defaut 1000),
  `cryptoAlgoTickRetentionHours` (defaut 24), `cryptoAlgoPriceTickRefQty` (defaut 50),
  `cryptoAlgoMinTimeToCloseBufferSeconds` (defaut 30), `cryptoAlgoLastCloseableBidMaxAgeMs` (defaut 60000),
  `cryptoAlgoSpreadAbsByInterval` (JSON override), `cryptoAlgoExitDefaultsByInterval` (JSON override),
  `cryptoAlgoPreCloseSecondsByInterval` (JSON override).
- **Crypto-algo cleanup** : `cryptoAlgoPriceTickCleanupEnabled` (defaut `true`),
  `cryptoAlgoPriceTickCleanupIntervalMinutes` (defaut 60).
- **Sim realism** : `simExecLatencyMode` (`fixed` | null), `simExecLatencyMs` (defaut 150),
  `simSelfImpactEnabled` (defaut `false`), `simSelfImpactTtlSeconds` (defaut 8),
  `simWalletPreflightEnabled` (defaut `false`), `simShadowLoggingEnabled` (defaut `false`),
  `shadowSampleRetentionDays` (defaut 14).
- **SL confirmation** : `slConfirmationTicks` (nombre d'évaluations consécutives
  requises avant d'émettre le signal SL, defaut 2).

### `SimulationStateSnapshot` (`simulation_state_snapshots`)

Archive immuable de l'etat simulation. Colonnes agreegees (equity, PnL, compteurs,
`source`, `label`, `session_id`) + JSON (`config_json`, `traders_json`, `positions_json`,
`executions_json`, `exit_attempts_json`, `move_events_json`, `decision_summary_json`).
Sources : `manual`, `auto`, `reset`. Service : `SimulationArchiveService`.

### `SimulationSession` (`simulation_sessions`)

Regroupe les snapshots d'une course de simulation entre deux resets. Champs :
`status` (`active` | `closed`), `started_at`, `ended_at`, `label`, `notes`,
agregats (`snapshot_count`, `peak_equity`, `trough_equity`, `ending_equity`,
`ending_session_pnl`, `baseline_capital`, `archive_summary_json` (resume archivage).
Une seule session `active` a la fois.
Service : `SimulationSessionService` ; archivage reset :
`SimulationResetArchiveService`.

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
Solde virtuel `pUSD` du mode simulation, initialise a `DEFAULT_SIM_BALANCE`,
reinitialisable via l'API.

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
throttle a 500 ms par asset, **uniquement pour les asset ayant au moins une position
ouverte**. Une ligne est inseree par position ouverte sur l'asset.

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
`GET /api/system-config/by-category/:category`.

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
- `RiskConfig` par defaut (valeurs des decorateurs `@Column`).
- `SimulationBalance` pUSD = `DEFAULT_SIM_BALANCE`.
