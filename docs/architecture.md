# Architecture

## 1. Organisation du monorepo

Polywatch est un monorepo npm (`workspaces: ["packages/*"]`) composé de six
packages liés par dépendances internes (`@polywatch/core` est consommé par
backend, worker, copy-trading et crypto-algo).

```
packages/
├── core/          @polywatch/core         → logique métier, entités, services
├── backend/       @polywatch/backend      → API REST + WebSocket
├── copy-trading/  @polywatch/copy-trading → détection copy (poll traders → order-signals)
├── worker/        @polywatch/worker       → exécution CLOB/sim + sorties risque
├── crypto-algo/   @polywatch/crypto-algo  → trading algorithmique crypto court-terme
├── weather-algo/  @polywatch/weather-algo → trading algorithmique météo (température)
└── frontend/      @polywatch/frontend     → UI SolidJS
```

| Package | Build | Dev | Rôle |
|---------|-------|-----|------|
| `core` | `tsc` | `tsc --watch` | Bibliothèque partagée, compilée vers `dist/` |
| `backend` | `tsc` | `tsx watch src/index.ts` | Serveur HTTP `:3000` |
| `copy-trading` | `tsc` | `tsx watch src/index.ts` | Détection copy (pas de serveur HTTP) |
| `worker` | `tsc` | `tsx watch src/index.ts` | Exécution + sorties risque (pas de serveur HTTP) |
| `crypto-algo` | `tsc` | `tsx watch src/index.ts` | Trading algorithmique crypto (pas de serveur HTTP) |
| `weather-algo` | `tsc` | `tsx watch src/index.ts` | Trading météo (pas de serveur HTTP) |
| `frontend` | `vite build` | `vite` | SPA servie par Vite |

## 2. Les processus applicatifs

### Backend (`packages/backend/src/index.ts`)

Serveur Express qui :
1. Initialise la `DataSource` TypeORM puis `seedDefaults` (admin, config de
   risque, solde de simulation) et `bootstrapWalletAccounts`.
2. Expose les routes REST sous `/api/*` (protégées par JWT) plus `/health` et
   `/metrics` (Prometheus, protégé par `x-service-token`). CORS restreint à la
   whitelist `CORS_ORIGIN` ; logs HTTP avec redaction des en-têtes sensibles.
3. Démarre le serveur WebSocket (Socket.IO) pour pousser les mises à jour temps
   réel vers le frontend.
4. Applique un rate-limit (`express-rate-limit`) — les appels internes des
   services (en-tête `x-service-token`) en sont exemptés.

Routes montées :

```
  app.use('/api/auth', jwtLimiter, createAuthRouter(ds));
  app.use('/api/watchlist', jwtLimiter, createWatchlistRouter(ds));
  app.use('/api/leaderboard', jwtLimiter, createLeaderboardRouter());
  app.use('/api/traders', jwtLimiter, createTraderInsightRouter(ds));
  app.use('/api/market-tags', jwtLimiter, createMarketTagsRouter());
  app.use('/market-icons', createMarketIconsRouter(ds));
  app.use('/api/markets', jwtLimiter, createMarketsRouter(ds));
  app.use('/api/algo-markets', jwtLimiter, createAlgoMarketsRouter(ds));
  app.use('/api/algo-auto-track', jwtLimiter, createAlgoAutoTrackRouter(ds));
  app.use('/api/algo/executions', jwtLimiter, createAlgoExecutionsRouter(ds));
  app.use('/api/algo/capital', jwtLimiter, createAlgoCapitalRouter(ds));
  app.use('/api/algo/markets-prices', jwtLimiter, createAlgoMarketsPricesRouter(ds));
  app.use('/api/algo/surveillance-history', jwtLimiter, createAlgoSurveillanceHistoryRouter(ds));
  app.use('/api/algo/events', jwtLimiter, createAlgoEventsRouter(ds));
  app.use('/api/algo/market-chart', jwtLimiter, createAlgoMarketChartRouter(ds));
  app.use('/api/market-chart', jwtLimiter, createMarketChartRouter(ds));
  app.use('/api/copied-positions', jwtLimiter, createPositionsRouter(ds));
  app.use('/api', jwtLimiter, createConfigRouter(ds));
  app.use('/api', jwtLimiter, createSimulationRouter(ds));
  app.use('/api/executions', jwtLimiter, createExecutionsRouter(ds));
  app.use('/api/move-events', jwtLimiter, createMoveEventsRouter(ds));
  app.use('/api/wallet', jwtLimiter, createWalletRouter(ds));
  app.use('/api/e2e-runs', jwtLimiter, createE2eRunsRouter(e2eRunner));
  app.use('/api', jwtLimiter, createMarketSyncConfigRouter(ds));
  app.use('/api/system-config', jwtLimiter, createSystemConfigRouter(ds));
  app.use('/api/internal', createInternalRouter(ds));
```

### Copy-trading (`packages/copy-trading/src/index.ts`)

Process sans serveur HTTP, **sans credentials CLOB**, qui possède entièrement
la détection copy :

- **MoveDetector** — polling Data API des traders (intervalle
  `RiskConfig.moveDetectorIntervalMs`, défaut 2 s) ; enqueue interne
  `move-events`.
- **CopyProcessor** — consomme `move-events`, gates risque, pipelines
  entry/exit → enqueue `COPY_*` sur `order-signals` (frontière vers le worker).
- Polling **toujours actif** (pas de standby) : les flags
  `simCopyTradingEnabled` / `realCopyTradingEnabled` bloquent uniquement les
  **entrées** ; les sorties miroir (`CLOSED` / `DECREASED`) continuent.
- Books entry via `PolymarketConnectionManager` (core) + `pending-move-assets`.
- Cash réel via backend HTTP + soustraction réservations / BUY in-flight (DB).
- MOS entry en API publique uniquement (pattern crypto-algo).
- Heartbeat Redis `copy-trading:heartbeat` (EX 60 s) + canal `heartbeat`.
- Boot : `markFirstPollPendingForNewTraders`, `recoverOrphans` (Redis),
  `recoverOrphanMoves` (DB).

Voir [`docs/code/05-copy-trading.md`](code/05-copy-trading.md).

### Worker (`packages/worker/src/index.ts`)

Process sans serveur HTTP qui **exécute** les ordres et décide les sorties
risque (SL/TP/pre-close/kill-switch). Il n'héberge plus MoveDetector /
CopyProcessor. Il établit **plusieurs connexions Redis distinctes** et démarre :

- **Consommateurs de files** : `order-signals`, `algo-order-signals`,
  `close-signals`, `execution-results`.
- **Processeurs** : deux `Executor` (entrées / sorties), `ResultsConsumer`.
- **Stratégie** (`StrategyProcessing`) — évaluation SL/TP/trailing toutes les ~100 ms
  sur **toutes** les positions ; émet sur `close-signals`.
- **Surveillances** : `MarketResolutionWatcher` (15 s), `RedemptionHandler` (15 s),
  `ClosingWatchdog`, `PlacingJanitor`, `ReservationJanitor`, `PendingEntryJanitor`
  (algo), `SimRealismJanitor`.
- **Market tracking** : `OpenPositionTracker` + `MarketTickRecorder` +
  `MarketPriceTickRecorder`.
- **Market price history** : `MarketPriceHistorySyncer`.
- **Market percent publisher** : `MarketPercentPublisher`.
- **Gestion des order books** via `PolymarketConnectionManager` (positions
  actives + sélections algo + browse Up/Down — **plus** de pending-move).
- **Verrouillage de positions** : `PositionLockRegistry`.
- **Canal utilisateur CLOB** : `UserChannelManager`.
- Souscriptions Redis : `config-changed`, `backend-ready`, `simulation-reset`,
  `algo-selections-changed`.
- Boot : `ensureCashIntegrity`, `recoverOrphans` sur les 4 files d'exécution,
  `waitForBackendReady`.
- Heartbeat Redis `worker:heartbeat` (EX 60 s).

Les sorties **miroir trader** (`COPY_CLOSE` / `COPY_DECREASE`) arrivent déjà
via `order-signals` depuis copy-trading. Les sorties **risque** restent 100 %
worker via `close-signals`.

### Crypto-Algo (`packages/crypto-algo/src/index.ts`)

Process sans serveur HTTP qui gère le trading algorithmique sur les marchés
crypto court-terme. Il :

- Charge les sélections de marchés (`AlgoMarketSelection`) et les règles
  d'auto-track.
- Exécute les stratégies enregistrées (actuellement `NaiveMomentumStrategy`)
  via un `StrategyRunner` en mode hybride (polling + WebSocket temps réel).
- Pousse les signaux dans le pipeline d'entrée (`AlgoEntryPipeline`) qui
  enqueue sur la file dédiée `algo-order-signals` (isolée de `order-signals`
  copy).
- Gère la surveillance OHLC (`MarketSurveillanceRecorder`), le nettoyage des
  marchés résolus (`MarketJanitor`), et publie les variations de prix en temps
  réel vers le backend.
- **Composants internes** :
  - `SignalStateRegistry` — registre d'état des signaux pour éviter les doublons.
  - `PositionContextCache` — cache de contexte de position pour les décisions d'entrée/sortie.
  - `AlgoChartTickPublisher` — publication des ticks de chart en temps réel (WebSocket `algo_chart_tick`).
  - `AlgoMarketPercentPublisher` — publication des pourcentages de marché algo.
  - `CryptoAlgoRuntimeStatusPublisher` — publication du statut runtime dans Redis (`crypto-algo:runtime-status`).
  - `SurveillanceJanitor` — nettoyage et archivage des cibles de surveillance dont la clôture traîne.
- Publie un heartbeat sur le canal Redis `heartbeat` toutes les 30 s
  (`crypto-algo:heartbeat` EX 60 s).

Voir [`docs/code/07-crypto-algo.md`](code/07-crypto-algo.md) pour le détail.

### Weather-Algo (`packages/weather-algo/src/index.ts`)

Process sans serveur HTTP — trading météo température. Détail : [`weather-algo.md`](./weather-algo.md).

- Entrées : discovery, Open-Meteo, edge, `WEATHER_OPEN` → `weather-order-signals`.
- Sorties : `WeatherExitEvaluator` → `WEATHER_FORECAST_CHANGE` / `WEATHER_PRE_CLOSE` sur `close-signals` (même si algo désactivé).
- Snapshot forecast à l'ouverture (`WeatherPositionForecast`).
- Auto-track : janitor sync règles → sélections (`lookAheadDays`, multi-dates discovery).
- Heartbeat + `weather-algo:runtime-status`.

### Frontend (`packages/frontend`)

SPA SolidJS servie par Vite. Communique avec le backend en REST (`/api`) et
reçoit les mises à jour via WebSocket. Voir [`frontend.md`](./frontend.md).

## 3. Communication inter-services

| Canal | Émetteur → Récepteur | Usage |
|-------|----------------------|-------|
| REST `/api/*` | Frontend → Backend | Lecture/écriture (watchlist, config, positions, marchés, algo, wallet, E2E…) |
| REST `/api/internal/*` | Worker / copy-trading / crypto-algo / weather-algo → Backend | Claims, balances, pnl-ticks, alerts, move-detected, circuit-breaker, queues… (auth `x-service-token`) |
| WebSocket (Socket.IO) `position_update` | Backend → Frontend | Mise à jour d'une position (copied-position) |
| WebSocket (Socket.IO) `execution` | Backend → Frontend | Nouvelle exécution |
| WebSocket (Socket.IO) `alert` | Backend → Frontend | Alerte (bannière UI) |
| WebSocket (Socket.IO) `pnl_tick` | Backend → Frontend | Tick PnL temps réel |
| WebSocket (Socket.IO) `market_tick` | Backend → Frontend | Tick de marché (mid price, spread) |
| WebSocket (Socket.IO) `market_pct_update` | Backend → Frontend | Variation % des marchés (publié par Worker & Crypto-Algo) |
| WebSocket (Socket.IO) `algo_chart_tick` | Backend → Frontend | Tick de charte algo (publié par Crypto-Algo) |
| WebSocket (Socket.IO) `move_detected` | Backend → Frontend | Nouveau mouvement détecté (relais copy-trading) |
| WebSocket (Socket.IO) `simulation_reset` | Backend → Frontend | Réinitialisation simulation |
| WebSocket (Socket.IO) `simulation_snapshot_created` | Backend → Frontend | Snapshot simulation créé |
| WebSocket (Socket.IO) `simulation_balance` | Backend → Frontend | Mise à jour solde simulation |
| WebSocket (Socket.IO) `algo_markets_changed` | Backend → Frontend | Marchés algo modifiés |
| WebSocket (Socket.IO) `e2e_position` | Backend → Frontend | Nouvelle position E2E |
| WebSocket (Socket.IO) `e2e_position_update` | Backend → Frontend | Mise à jour position E2E |
| WebSocket (Socket.IO) `e2e_log` | Backend → Frontend | Log E2E |
| WebSocket (Socket.IO) `e2e_run_started` | Backend → Frontend | Run E2E démarré |
| WebSocket (Socket.IO) `e2e_run_finished` | Backend → Frontend | Run E2E terminé |
| File Redis `move-events` | copy-trading (interne) | MoveDetector → CopyProcessor |
| File Redis `order-signals` | copy-trading → worker | Signaux `COPY_*` |
| File Redis `algo-order-signals` | crypto-algo → worker | Signaux `ALGO_*` |
| File Redis `weather-order-signals` | weather-algo → worker | Signaux `WEATHER_OPEN` |
| File Redis `close-signals` | worker Strategy / weather-algo → worker Executor | SL/TP/pre-close/kill-switch / closes manuels / `WEATHER_FORECAST_CHANGE` / `WEATHER_PRE_CLOSE` |
| File Redis `execution-results` | worker Executor → ResultsConsumer | Finalisation |
| Pub/Sub Redis | Backend → worker / copy-trading / crypto-algo / weather-algo | `config-changed`, `backend-ready`, `simulation-reset` |
| Pub/Sub Redis | Crypto-Algo → Backend | `crypto-algo:runtime-status` (statut runtime) |
| HTTP (interne) | `StrategyProcessing` / `ResultsConsumer` → Backend | Push des pnl ticks et exécutions vers les WebSocket |

## 4. Files Redis et fiabilité

Les files sont implémentées par `RedisQueue<T>`
(`packages/core/src/worker-shared/redis-queue.ts`, aussi utilisée par
copy-trading / crypto-algo ; le worker conserve un miroir local historique) avec
un pattern *reliable queue* :

- `enqueue` → `RPUSH` sur la liste.
- `startConsumer` → `BRPOPLPUSH name → name:processing` (atomique, bloquant 5 s).
- Succès → `LREM` de l'élément en cours de traitement.
- Échec → compteur de tentatives (`::retries`, TTL 1 h). Au-delà de
  `MAX_RETRIES = 3`, l'élément part en *dead letter* (`name:dead`).
- `recoverOrphans` (au démarrage) → réinjecte les éléments restés dans
  `:processing` après un crash.
- `replayDead` → permet de rejouer les éléments morts (exposé via
  `/api/internal/queues/:name/replay-dead`).

## 5. Persistance

- **PostgreSQL** via TypeORM (`pg` driver), connexion via `DATABASE_URL`.
- Migrations formelles : `npm run migrate` (`core/src/migrate.ts`, migrations + seed).
- Timeouts : `statement_timeout=30s`, `lock_timeout=10s`.
- `synchronize: true` disponible en dev (désactivé en production sauf `ALLOW_SYNCHRONIZE_PROD`).

```ts
export function createDataSource(opts?: { synchronize?: boolean; migrationsRun?: boolean }): DataSource {
  return new DataSource(buildDataSourceOptions(opts));
}
```

## 6. Observabilité

- **Logs** : `pino` avec un nom de logger par composant (`copy-trading`,
  `move-detector`, `copy-processor`, `worker`, `executor`, `strategy`…).
- **Métriques** : `prom-client` exposées sur `GET /metrics` (registry backend
  uniquement). Push circuit breaker via
  `POST /api/internal/metrics/circuit-breaker`. Voir [`metrics.md`](./metrics.md).
- **Alertes** : `POST /api/internal/alerts` relaie les alertes services vers la
  bannière UI.
- **Health check** : `GET /health` (utilisé par `wait-on` au démarrage).
- **Heartbeats** (canal Redis `heartbeat` + clé SET EX 60 s, intervalle 30 s) :
  - `worker:heartbeat`
  - `copy-trading:heartbeat`
  - `crypto-algo:heartbeat`
  Lus par `GET /api/system/overview` pour l'onglet System Overview.
