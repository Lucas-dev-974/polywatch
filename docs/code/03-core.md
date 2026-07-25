# Package `@polywatch/core`

Domaine partagé entre backend et worker : entités, services, calculs métier. Tout est testé via Vitest (`*.test.ts` colocalisés).

## Arborescence

```
core/src/
├── config/        env (.env racine, chemins), secrets (validation prod)
├── database/      DataSource TypeORM PostgreSQL (pg driver)
├── entities/      43 entités TypeORM
├── idempotence/   hashes SHA-256 des événements et ordres
├── market/        cycle de vie marché (settled, payoff, polling) + tags Gamma (whitelist, enrichissement events)
├── move-events/   règles de pertinence des événements
├── orders/        construction des signaux de fermeture
├── polymarket/    signature CLOB, contrats, métadonnées marché, pUSD, rédemption
├── positions/     prix mark, labels d'outcome
├── pricing/       VWAP (walkBook), frais taker
├── queue/         définition des 4 files worker + dead-letter
├── risk/          policy SL/TP/trailing/pre-close, extraction par mode
├── seed/          défauts initiaux + backfill config héritée
├── services/      41 modules de services (incluant algo-auto-track, algo-market-selection, algo-surveillance, algo-events, market-position-tick, market-price-tick, market-price-history-sync, market-sync-config, real-archive, real-session, real-portfolio, simulation-session, simulation-reset-archive, sim-execution-stats, risk-config-revision, analysis-report, system-config, exit-attempt-event, crypto-algo-runtime-status)
├── simulation/    comptabilité cash sim
├── sizing/        calcul de quantité copiée
├── types/         types partagés (TradingMode, OrderSignal, etc.)
├── migrate.ts     création du schéma + seed (one-shot)
├── migration-backfill.ts  backfill colonnes héritées
└── migrations/    63 migrations TypeORM (Baseline, Algo*, CryptoAlgo*, AlgoPriceTick*, MarketPositionTicks*, MarketPriceTicks*, E2e*, SnapshotSystemV2, RealSessions, SimulationSessions, AnalysisReports, etc.)
```

## Entités (PostgreSQL)

| Entité | Table | Points clés |
|---|---|---|
| `User` | `users` | Mono-utilisateur, `password_hash` bcrypt (coût 12) |
| `WatchlistEntry` | `watchlist` | Adresse trader lowercase, flags `active`/`simEnabled`/`realEnabled`, max 20 |
| `RiskConfig` | `risk_config` | Tous les paramètres en paires `*Sim`/`*Real` : simMaxPositionSizeUsdc/realMaxPositionSizeUsdc, simMaxOpenPositions/realMaxOpenPositions, simMaxExposureUsdc/realMaxExposureUsdc, simSlBidPoints/realSlBidPoints, simTpBidPoints/realTpBidPoints, slEnabled/tpEnabled, trailing (activation + stop), preClose (window + holdIfWinning), simMaxDailyLossUsdc/realMaxDailyLossUsdc, simKillSwitchAction/realKillSwitchAction, sizing, `simAllowedMarketTags`/`realAllowedMarketTags` (JSON whitelist slugs marché) ; params crypto-algo : `cryptoAlgoEnabled`, `cryptoAlgoStrategies` (JSON), `cryptoAlgoSlEnabled`/`cryptoAlgoTpEnabled`/`cryptoAlgoTrailingEnabled`, `cryptoAlgoSlBidPoints`/`cryptoAlgoTpBidPoints` (bid absolu pour marchés binaires), `cryptoAlgoTrailingBidPoints`/`cryptoAlgoTrailingActivationBidPoints`, `cryptoAlgoPreCloseEnabled`/`PreCloseSeconds`/`PreCloseKeepEnabled`/`PreCloseKeepBidThreshold`, `cryptoAlgoMinTimeToClose`, `cryptoAlgoSizingMode`/`EntryUsdcAmount`/`EntryShareCount`, `cryptoAlgoReentryWindowMs`/`MaxEntriesPerWindow`, `cryptoAlgoSlQuotaEnabled`/`QuotaPerMarket`/`QuotaCacheTtlSeconds`, `cryptoAlgoEntryPriceMin`/`EntryPriceMax`/`EntryPriceBandEnabled`, `cryptoAlgoCurveFilterEnabled`/`CurveLookbackMs`/`CurveMinDelta`, tunables stratégie (`cryptoAlgoBaseThreshold`, `cryptoAlgoSpreadAdjustmentFactor`, `cryptoAlgoMaxSpreadAbs`, etc.), sim realism (`simExecLatencyMode`, `simSelfImpactEnabled`, `simShadowLoggingEnabled`) |
| `ClobCredentials` | `clob_credentials` | apiKey/secret/passphrase/signerPrivateKey **chiffrés AES-256-GCM**, signatureType |
| `WalletAccount` | `wallet_accounts` | Deposit address + funder + signer PK chiffré |
| `TraderSnapshot` | `trader_snapshots` | UNIQUE(trader, conditionId, assetId) — dernière position connue |
| `TraderSnapshotSeq` | `trader_snapshot_seq` | Séquence monotone par trader (idempotence) |
| `MoveEventEntity` | `move_events` | id = hash SHA-256, type OPENED/INCREASED/DECREASED/CLOSED, flag `processed` |
| `CopiedPosition` | `copied_positions` | Statuts : `pending → open → closing → closed` (+ `failed`, `pending_resolution`, `cancelled`) ; `entryPrice`, `entryBidVwap`, `entryQuantityRemaining`, `entryFeesRemaining`, PnL réalisé/latent, `peakClosurePnlPercent` (clôture), `peakBidVwap` (pic du bid pour trailing), `closingAttemptSeq`, `closingReason`, `closeReason` |
| `Execution` | `executions` | Statuts `placing → filled/failed` ; fillPrice (VWAP pondéré sur partiels), fillQuantity, fees, realizedPnl, clobOrderId |
| `PositionReservation` | `position_reservations` | Notionnel USDC réservé, TTL 180 s |
| `SimulationBalance` | `simulation_balances` | Cash pUSD sim (ligne unique, défaut 10 000) |
| `SimulationStateSnapshot` | `simulation_state_snapshots` | Archives d'état sim (JSON config/traders/positions/exécutions) — [`snapshots-simulation.md`](../snapshots-simulation.md) |
| `Market` | `markets` | tokenIdYes/No, endDate, negRisk, `feeRate`/`feeExponent` (frais CLOB dynamiques), lifecycle (active/resolved/closed/acceptingOrders/winningTokenId), `category`, `tagSlugs` (cache filtre copie), `marketType` |
| `AlgoAutoTrackRule` | `algo_auto_track_rules` | Règle auto-track `(cryptoSymbol, interval)` unique, flag `enabled` |
| `AlgoMarketSelection` | `algo_market_selections` | Marché sélectionné pour crypto-algo (`conditionId`, `cryptoSymbol`, `interval`, `slug`, `enabled`) |
| `AlgoSurveillanceSnapshot` | `algo_surveillance_snapshots` | Snapshot OHLC surveillance (open/close up/down, `marketStartAt`/`EndAt`, `unresolvedAt`) — `UNIQUE(conditionId)` |
| `AlgoPriceTick` | `algo_price_ticks` | Ticks UP/DOWN 1 Hz (`PriceTickRecorder`) + métriques enrichies ; purge > 24 h ; chart API |
| `IntegrationSettings` | `integration_settings` | Paramètres d'intégration tiers (clé API Polygonscan chiffrée, singleton) |
| `MarketPositionTick` | `market_position_ticks` | Tick de marché persisté par book update (throttle 500 ms/asset) pour les assets avec positions ouvertes : `bestBid`/`bestAsk`/`midPrice`/`spread`/`spreadPercent`, VWAP exécutables (`executableBidVwap`/`executableAskVwap`), `lastTradePrice`. Index : `copiedPositionId`, `(conditionId, createdAt)`, `(assetId, createdAt)`, `createdAt` (purge). Rétention 30 j (`MARKET_TICK_RETENTION_DAYS`), purge horaire batchée par 5 000 lignes via `MarketPositionTickService.purgeOlderThan` |
| `E2eTestRun` | `e2e_test_runs` | Runs de tests E2E (suite, statut, durée, logs) — démarrés via `/api/e2e-runs` |
| `E2eRunPosition` | `e2e_run_positions` | Positions d'un run E2E (conditionId, prix d'entrée, PnL, statut) |
| `SimulationSession` | `simulation_sessions` | Sessions de simulation entre deux resets (status, started_at, ended_at, label, notes, agrégats) |
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
| `RiskConfigRevision` | `risk_config_revisions` | Journal append-only des mises à jour `risk_config` (source, patch_json, config_json, config_fingerprint) |
| `AnalysisReport` | `analysis_reports` | Snapshots de rapports d'analyse persistés (type, label, params_json, payload_json, config_fingerprint) |
| `MarketPriceTick` | `market_price_ticks` | Ticks de marché par `conditionId` (timer 1s, indépendant des positions) pour graphique UI non-crypto |
| `MarketPriceHistorySync` | `market_price_history_sync` | Registre de synchronisation de l'historique des prix de marché |
| `MarketSyncConfig` | `market_sync_config` | Configuration de synchronisation des marchés (intervalles, backoff, concurrency) |
| `SystemConfig` | `system_config` | Configuration système clé/valeur avec catégorisation |
| `ExitAttemptEvent` | `exit_attempt_events` | Journal des tentatives de sortie (SL/TP/PRE_CLOSE) avec mark price et raison de blocage |
| `ClobLatencySample` | `clob_latency_samples` | Échantillons de latence RTT d'exécution CLOB pour le calibrage simulation |
| `ShadowFill` | `shadow_fills` | Fills simulés (shadow logging) pour l'audit de réalisme d'exécution |

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

- `triggerPnlPercent = (bidVwap − entryBidVwap)/entryBidVwap × 100` — base des déclencheurs SL/TP (bid contre bid d'entrée, élimine le spread **après** l'ouverture).
- `displayPnlPercent = (bidVwap − entryPrice)/entryPrice × 100` — affichage (« clôture » UI, hors frais).
- `closurePnlPercent = ((bidVwap − entryPrice) × quantity − entryFeesRemaining) / (entryPrice × quantity) × 100` — PnL clôture avec frais, utilisé pour l'évaluation hybride SL/TP.
- `unrealizedPnl = (bidVwap − entryPrice) × quantity − entryFeesRemaining`.

**Spread** : écart entre le prix d'achat (ask) et le prix de revente immédiate
(bid). Un spread extrême à l'entrée peut produire une forte perte en « clôture »
alors que « marché » reste proche de 0 %. Le filtre `*MinBidToAskRatio` dans
`CopyProcessor` bloque ces entrées avant réservation.

**`fees.ts`** : frais taker Polymarket `C × (bps/10000) × p × (1−p)`, arrondi 5 décimales, plancher 0.00001.

## Risque (`risk/policy.ts`)

- `pickModeValue` extrait la variante `Sim`/`Real` d'un paramètre.
- `getModeMinBidToAskRatio` / `isEntryBidAskRatioAcceptable` : garde-fou
  d'entrée — refuse la copie si `bidVwap / askVwap` est sous le seuil du mode
  (`0` désactive).
- `getModeAllowedMarketTags` / `isMarketTagAllowedForMode` : whitelist vide = tout autorisé ; sinon intersection avec les slugs résolus du marché.
- `evaluateSlTpTrailing` : ordre d'évaluation **SL → TP → TRAILING**.
  - **SL hybride (OR)** : déclenché si `effectiveTrigger ≤ −slPercent` **OU**
    `effectiveClosure ≤ −slPercent`. `effectiveTrigger` compare le bid actuel au
    bid d'entrée, et `effectiveClosure` compare le bid actuel au prix d'entrée
    plus frais. Protège contre les spreads extrêmes à l'entrée où le marché
    reste plat mais la clôture montre une perte massive.
  - **TP hybride (AND)** : déclenché uniquement si `effectiveTrigger ≥ tpPercent`
    **ET** `effectiveClosure ≥ tpPercent`. Évite les TP « fantômes » sur spread
    d'entrée (gain marché mais perte clôture).
  - **Trailing** : s'arme quand `peakClosurePnlPercent ≥ trailingActivationPercent`,
    puis se déclenche sur drawdown ≥ `trailingStopPercent` depuis le pic de
    clôture. Protection des gains réellement réalisables.
  - **Marché illiquide / lastTradePrice** : quand le book est illiquide ou figé,
    `resolveExitDecisionMarkPrice` peut tomber sur un `lastTradePrice` connu
    plus défavorable que le bid affiché. Dans ce cas l'évaluation utilise
    `min(availableBid, lastTradePrice)` comme prix de référence, ce qui permet
    de déclencher la sortie sur le dernier trade réel plutôt que sur un bid
    fantôme proche de l'entrée.
  - Valeur `0`/`null` = paramètre désactivé.
- `evaluatePreCloseExit` : dans la fenêtre pre-close (`endDate − preCloseWindow`, ou après `endDate` si `acceptingOrders=true`) :
  - Si `preCloseHoldIfWinning` et PnL de vente projeté ≥ 0 USDC (`projectedRealizedPnlUsdc`) : aucune sortie — la position reste ouverte jusqu'à la résolution (`RedemptionHandler`). L'exécuteur annule aussi un `PRE_CLOSE_LOSS` si le fill simulé/réel serait non négatif (`pre_close_hold_winning`).
  - Sinon : `PRE_CLOSE_LOSS` si `trigger < 0` **OU** `closure < 0` (logique hybride OR, alignée sur le SL).
  - **Note** : le pipeline copy-trading n'émet jamais `PRE_CLOSE_WIN`. Le module
    crypto-algo peut émettre `PRE_CLOSE_WIN` lorsque `cryptoAlgoPreCloseWinConfidenceBid`
    est configuré (tenue des positions gagnantes quasi certaines en fenêtre pre-close).
  - Cas typique retenu par `holdIfWinning` : spread d'entrée où `trigger < 0` mais `closure ≥ 0` (position économiquement gagnante malgré un bid sous le bid d'entrée).

## Sizing (`sizing/`)

- `compute.ts` : quantité copiée proportionnelle (taille du mouvement du trader / portefeuille du trader × capital utilisateur), plafonnée par `maxPositionSizeUsdc` et le solde disponible.
- `entry-sizing.ts` : orchestration avec le triple-pass VWAP (estimation qty, ask exact, bid/ask final pour filtre liquidité).
- `resume-reserved-entry.ts` : `resumeEntryFromReservation` — ré-enfile un BUY après réservation réussie mais enqueue Redis échoué ; libère la réservation sur skip permanent (partagé copy + crypto-algo).

## Simulation (`simulation/accounting.ts`)

- Achat : `cashDebit = fillPrice × fillQty + fees`.
- Vente : `feeAlloc = entryFeesRemaining × (fillQty / entryQtyRemaining)` (prorata),
  `realizedPnl = proceeds − entryPrice×fillQty − exitFees − feeAlloc`,
  `cashCredit = proceeds − exitFees`.
- Rédemption : vente à payoff 0/1 sans frais de sortie.

## Marché & rédemption (`market/`, `polymarket/`)

- `isMarketSettled` : `winningTokenId` connu **ET** (`resolved` OU (`closed` ET `acceptingOrders=false`)).
- `getRedemptionPayoff(winningTokenId, assetId)` → 0|1.
- `market/tags.ts` : parsing slugs Gamma (`parseTagSlugsFromGammaRaw`), whitelist (`isMarketTagAllowed`), catalogue nav (`NAV_MARKET_TAG_SLUGS`, `buildNavMarketTags`), enrichissement via `GET /events?slug=…` (`enrichGammaMarketTags`).
- `market-metadata.ts` : `fetchGammaMarket` tente Gamma (ouverts puis fermés) puis CLOB en fallback ; mapping outcomes→tokenIdYes/No (`yes/up`, `no/down`, fallback par ordre).
- `MarketService.resolveTagSlugs` : lit `markets.tag_slugs` en cache PostgreSQL, sinon fetch Gamma + persistance.
- `clob-signature.ts` : résolution du type de signature — deposit wallets ⇒ POLY_1271 (type 3).
- `pusd-amount.ts` : conversions BigInt ↔ number en 6 décimales (`parsePusdAmount`, `formatPusdAmount`, tolérance ±1 micro-unité).
- `clob-contracts.ts` : adresses Polygon mainnet (Exchange, NegRiskAdapter, CTF, collatéral).
- `collateral-tokens.ts` : adresses pUSD, USDC.e (`USDC_NATIVE_ADDRESS` Circle complète), helpers de résolution collatéral.

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
| `RiskService` | Config risque ; `checkKillSwitch` (PnL réalisé du jour UTC vs `maxDailyLossUsdc`) |
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
| `SimulationSessionService` | Gestion des sessions de simulation |
| `SimulationResetArchiveService` | Archivage reset simulation (création session close + archivage) |
| `SimExecutionStatsService` | Statistiques d'exécution simulation (latence p50/p90, shadow fills) |
| `RiskConfigRevisionService` | Journal append-only des révisions `risk_config` |
| `AnalysisReportService` | CRUD rapports d'analyse persistés |
| `SystemConfigService` | CRUD configuration système (clés/valeurs, catégories) |
| `ExitAttemptEventService` | `listByPosition` — journal des tentatives de sortie |
| `CryptoAlgoRuntimeStatusService` | Publication/lecture du statut runtime crypto-algo via Redis |
| `MarketResolutionService` | Détection des marchés réglés → positions `pending_resolution` |
| `AlgoSurveillanceService` | `findLiveMarkets`, gestion snapshots de surveillance OHLC |
| `AlgoSelectionBookAssets` | Résolution des assets de book pour les sélections algo |

## Prix mark (`positions/mark.ts`)

Priorité : marché réglé → payoff 0/1 ; sinon bid du carnet ; sinon dernier `executableBidVwap` ; sinon `entryBidVwap ?? entryPrice`. `sumOpenPositionsValue` sert au snapshot d'equity de simulation.
