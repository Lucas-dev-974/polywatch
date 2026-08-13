# Référence API

Le backend (`packages/backend`) expose une API REST sous `/api` et un canal
temps réel WebSocket (Socket.IO). Toutes les routes (sauf indication) requièrent
un **JWT** (`Authorization: Bearer <accessToken>`). Les routes `/api/internal/*`
sont réservées au worker via l'en-tête `x-service-token`.

## Authentification

JWT signés avec `JWT_SECRET` (access) et `JWT_REFRESH_SECRET` (refresh) — voir
`packages/backend/src/auth/jwt.js`. Le frontend rafraîchit automatiquement le
token sur un `401 invalid_token` (`packages/frontend/src/api.ts`).

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/auth/login` | — | `{username, password}` → `{accessToken, refreshToken}` |
| POST | `/api/auth/refresh` | — | `{refreshToken}` → nouveaux tokens |

Codes d'erreur : `invalid_body` (400), `invalid_credentials` (401),
`missing_token` (400), `invalid_token` (401).

## Watchlist

Toute modification publie `config-changed` sur Redis (rechargement worker).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/watchlist` | Liste des traders surveillés |
| POST | `/api/watchlist` | Ajoute `{traderAddress, nickname?, simEnabled?, realEnabled?}` (409 `max_watchlist_size`, max 20) |
| PATCH | `/api/watchlist/:id` | Met à jour une entrée (`active`, flags, nickname) |
| DELETE | `/api/watchlist/:id` | Supprime (204) |
| GET | `/api/watchlist/settings` | Paramètres de la watchlist |
| PUT | `/api/watchlist/settings` | Met à jour les paramètres de la watchlist |

## Positions copiées

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/copied-positions?status=&mode=` | Positions filtrées (enrichies par `CopiedPositionPresenter`) ; `status=closed` trie par date de clôture et résout `closeReason` |
| POST | `/api/copied-positions/:id/close` | Clôture manuelle (`MANUAL`) ; pousse un `OrderSignal` SELL sur la file Redis `close-signals` (consommée par Executor B). 409 si statut ≠ `open`/`failed`. Pas de retry métrique dédié — voir [`pipeline-copy-trading.md`](./pipeline-copy-trading.md). |
| GET | `/api/copied-positions/:id/ticks` | Ticks de marché pour une position copiée |
| GET | `/api/copied-positions/:id/exit-attempts` | Journal des tentatives de sortie (SL/TP/PRE_CLOSE) avec mark price et raison de blocage — pagination `?limit=` (max 100) |

## Configuration (risk / simulation / CLOB)

Montées sous `/api` (`createConfigRouter`).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/config/global` | Config globale (`global_config`) — trading réel, slippage, auto-snapshot, exécution sim |
| PUT | `/api/config/global` | Met à jour la config globale ; append `risk_config_revisions` (kind `global`) |
| GET | `/api/config/copy` | Config copy-trading (`copy_config`) |
| PUT | `/api/config/copy` | Met à jour la config copy ; append révision (kind `copy`) |
| GET | `/api/config/crypto` | Config crypto-algo (`crypto_config`) — inclut `cryptoAlgoConfigFingerprint` pour la garde apply des rapports algo |
| PUT | `/api/config/crypto` | Met à jour la config crypto ; accepte `expectedCryptoAlgoConfigFingerprint` (409 si mismatch) et `revisionSource` |
| GET | `/api/config/weather` | Config weather-algo (`weather_config`) |
| PUT | `/api/config/weather` | Met à jour la config weather-algo |
| GET | `/api/market-tags` | Catalogue des types de marché pour le picker UI : `nav` (catégories principales) + `tags` (recherche optionnelle `?search=`) + `cryptoTags` (tags crypto-algo) |
| GET | `/api/simulation-balance` | Solde pUSD simulé pour un périmètre — query **`algoKind`** (`crypto` \| `weather` \| `copy`, défaut `crypto`) |
| POST | `/api/simulation-balance/reset` | Réinitialise **un** périmètre sim : body `{ algoKind: 'crypto'\|'weather'\|'copy', amount?, archive?: true, deepClean?: false, newSessionLabel? }` — **`algoKind` requis** ; lock Redis `sim:reset:lock:${algoKind}` (SET NX PX 10 s) ; snapshot `reset` + archivage session **du kind** (défaut), purge marché **scopée** aux conditions du kind, wipe positions/exécutions/réservations **du kind**, persist `amount` dans `simInitialCapital{Crypto\|Weather\|Copy}` (table isolée du kind), purge Redis **scopée** (queues d'entrée du kind + close/results matchés par position/signal IDs ou raisons `ALGO_`/`COPY_`/`WEATHER_`), rotation session du kind, pub/sub `simulation-reset` avec `algoKind` ; réponse : `archiveSummary`, `redisPurge`, `warnings[]` |
| GET | `/api/simulation-snapshots` | Liste des snapshots — query **`algoKind` requis** + pagination / filtres (`source`, `sessionId`, `label`, `from`, `to`) |
| POST | `/api/simulation-snapshots` | Crée un snapshot manuel `{ algoKind: 'crypto'\|'weather'\|'copy', label?: string }` — **`algoKind` requis** |
| GET | `/api/simulation-snapshots/:id` | Détail d'un snapshot |
| DELETE | `/api/simulation-snapshots` | Supprime les snapshots **du kind** — query **`algoKind` requis** (`crypto\|weather\|copy`) ; 400 si absent ; les autres kinds ne sont pas touchés |
| GET | `/api/simulation-sessions` | Liste des sessions — query **`algoKind` requis** + `status`, `label`, `from`, `to` |
| GET | `/api/simulation-sessions/current` | Session active du kind — query **`algoKind` requis** (ou `null`) |
| GET | `/api/simulation-sessions/:id` | Détail d'une session (query **`algoKind` requis**) — **404** si la session n'existe pas ou si `session.algoKind !== algoKind` |
| GET | `/api/simulation-sessions/:id/archive` | Archive requêtable d'une session close : `?type=positions\|executions\|exit_attempts\|surveillance\|candles` + pagination |
| PATCH | `/api/simulation-sessions/:id` | Met à jour `{ label?, notes? }` |
| DELETE | `/api/simulation-sessions/:id` | Supprime une session **fermée** — query **`algoKind` requis** ; `?deleteSnapshots=true` pour supprimer aussi ses snapshots |
| DELETE | `/api/simulation-sessions/closed` | Supprime toutes les sessions fermées du kind — query **`algoKind` requis** |
| GET | `/api/real-snapshots` | Liste des snapshots réel (pagination, filtres, `sessionId`) |
| POST | `/api/real-snapshots` | Crée un snapshot manuel `{ label?: string }` (cash wallet requis) |
| GET | `/api/real-snapshots/:id` | Détail d'un snapshot réel |
| DELETE | `/api/real-snapshots` | Supprime tous les snapshots réel |
| GET | `/api/real-sessions` | Liste des périodes réel |
| GET | `/api/real-sessions/current` | Période active |
| GET | `/api/real-sessions/:id` | Détail d'une période |
| GET | `/api/real-sessions/:id/archive` | Archive paginée (`type`, `limit`, `offset`) |
| PATCH | `/api/real-sessions/:id` | `{ label?, notes? }` |
| DELETE | `/api/real-sessions/:id` | Période fermée (`?deleteSnapshots=true`) |
| POST | `/api/real-sessions/rotate` | Clôture période : `{ archive?: true, clearClosedLive?: false, newPeriodLabel? }` — snapshot `rotate`, archivage closed, rotation ; **503** si wallet illisible |
| GET | `/api/simulation/analytics` | Analytics simulation (agrégats) |
| GET | `/api/simulation/analytics/trader-pnl-series` | Série PnL par trader |
| GET | `/api/simulation/analytics/market` | Analytics par marché |
| GET | `/api/simulation/analytics/market-pnl-series` | Série PnL par marché |
| GET | `/api/sim-execution-stats` | Statistiques d'exécution simulation (p50/p90 RTT, shadow fills) |
| GET | `/api/system-config` | Configuration système (clés/valeurs) |
| GET | `/api/system-config/:key` | Valeur d'une clé système spécifique |
| GET | `/api/system-config/by-category/:category` | Configuration système filtrée par catégorie |
| PUT | `/api/system-config/:key` | Met à jour une clé système spécifique |
| POST | `/api/system-config/seed` | Initialise les valeurs système par défaut |
| GET | `/api/system/overview` | Vue d'ensemble système (heartbeats services, files Redis, santé backend/postgres/redis) |
| GET | `/api/market-sync-config` | Configuration de synchronisation des marchés (intervalles, backoff, concurrency) |
| PUT | `/api/market-sync-config` | Met à jour la configuration de synchronisation des marchés |
| GET | `/api/clob-credentials/status` | Statut des credentials CLOB (présence, pas les secrets) |
| POST | `/api/clob-credentials` | Enregistre/chiffre les credentials CLOB/relayer |
| DELETE | `/api/clob-credentials` | Supprime les credentials |
| GET | `/api/integration-settings/polygonscan/status` | Statut de la clé API Polygonscan |
| PUT | `/api/integration-settings/polygonscan` | Enregistre la clé API Polygonscan |
| DELETE | `/api/integration-settings/polygonscan` | Supprime la clé API Polygonscan |

## Exécutions

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/executions` | JWT | Historique des exécutions |
| POST | `/api/executions` | `x-service-token` | Reçue depuis le worker ; rediffuse via WebSocket |

## Runs E2E

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/e2e-runs` | JWT | Démarre un run de tests E2E (suite, mode sim/real) |
| GET | `/api/e2e-runs` | JWT | Liste des runs (filtres statut, suite) |
| GET | `/api/e2e-runs/:id` | JWT | Détail d'un run + positions |
| GET | `/api/e2e-runs/suites` | JWT | Liste des suites de tests disponibles |
| GET | `/api/e2e-runs/suites/overview` | JWT | Vue d'ensemble des suites |
| GET | `/api/e2e-runs/active` | JWT | Run E2E actif (s'il y en a un) |
| GET | `/api/e2e-runs/:id/positions` | JWT | Positions d'un run E2E |
| GET | `/api/e2e-runs/:id/logs` | JWT | Logs d'un run E2E |
| POST | `/api/e2e-runs/:id/cancel` | JWT | Annulation d'un run E2E |

## Mouvements de traders

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/move-events` | Derniers mouvements détectés |
| DELETE | `/api/move-events` | Purge l'historique des mouvements |

## Leaderboard

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/leaderboard` | Classement de traders (données Polymarket) |

## Portefeuille (wallet / dépôt / retrait)

`createWalletRouter` — intégration Polymarket (pUSD, bridge, relayer).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/wallet` | État du portefeuille (soldes, adresses) |
| POST | `/api/wallet/pusd/withdraw` | Retrait pUSD |
| POST | `/api/wallet/pusd/withdraw/prepare` | Prépare un retrait (à signer côté client) |
| POST | `/api/wallet/pusd/withdraw/submit` | Soumet le retrait signé |
| GET | `/api/wallet/bridge/supported-assets` | Actifs supportés par le bridge |
| POST | `/api/wallet/bridge/deposit-addresses` | Adresses de dépôt bridge |
| POST | `/api/wallet/bridge/deposit-quote` | Devis de dépôt |
| GET | `/api/wallet/bridge/status/:address` | Statut d'un dépôt bridge |

> Détail des snapshots simulation (sources, contenu, auto-snapshot, UI) :
> [`snapshots-simulation.md`](./snapshots-simulation.md).

### Comptes de wallet (`/api/wallet-accounts`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/wallet/accounts` | Liste des comptes wallet |
| POST | `/api/wallet/accounts` | Crée un compte (chiffré si `signerPrivateKey`) |
| PUT | `/api/wallet/accounts/:id` | Met à jour un compte |
| GET | `/api/wallet/accounts/:id/history` | Historique on-chain (dépôts/retraits Polygonscan) |
| DELETE | `/api/wallet/accounts/:id` | Supprime un compte |

### Marchés (`/api/markets`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/markets` | Liste paginée des marchés Gamma (keyset pagination) |
| GET | `/api/markets/:conditionId/metrics` | Métriques de marché (volume, prix, historique) |
| GET | `/api/markets/:conditionId/ticks` | Ticks de marché pour un marché |

**Query params liste** : `limit` (1-100), `afterCursor`, `order`, `ascending`, `tagSlug` (filtre par tag), `active` (marchés actifs uniquement).

**Query params metrics** : `assetId` (YES/NO token), `includeHistory`, `cryptoSymbol`, `interval`.

> Inventaire des champs exposés, sources externes (Gamma, CLOB, Data API, CoinGecko),
> lacunes et métriques additionnelles envisageables :
> [`metriques-marche.md`](./metriques-marche.md).

### Trader Insight (`/api/traders`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/traders/:address/insight` | Profil complet d'un trader Polymarket |

Retourne : profil (nom, avatar, bio), statistiques d'activité, timeline des trades, série de capital, répartition par marché, positions ouvertes, statistiques sim (si dans watchlist), analyse de financement.

**Query params** : `leaderboardRank`, `leaderboardPnl`, `leaderboardVol`, `userName`, `profileImage`, `xUsername`, `verifiedBadge`, `refreshFunding`.

## Marchés & icônes

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/market-icons/:conditionId` | Icône de marché (proxy image, **sans préfixe** `/api`) |

## Crypto-Algo (`/api/algo-*`)

Gestion du module de trading algorithmique (voir
[`code/07-crypto-algo.md`](./code/07-crypto-algo.md)).

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/algo-markets` | JWT | Sélections de marchés crypto-algo |
| POST | `/api/algo-markets` | JWT | Ajoute une sélection (`conditionId`, `cryptoSymbol`, `interval`, `slug`) |
| DELETE | `/api/algo-markets/:conditionId` | JWT | Supprime une sélection |
| PATCH | `/api/algo-markets/:conditionId` | JWT | Active/désactive une sélection (`enabled`) |
| GET | `/api/algo-markets/status` | JWT | Statut runtime du runner crypto-algo (depuis Redis `crypto-algo:runtime-status`) |
| GET | `/api/algo-auto-track` | JWT | Règles d'auto-track (`cryptoSymbol`, `interval`, `enabled`) |
| POST | `/api/algo-auto-track` | JWT | Crée une règle d'auto-track |
| DELETE | `/api/algo-auto-track/:id` | JWT | Supprime une règle |
| PATCH | `/api/algo-auto-track/:id` | JWT | Active/désactive une règle |
| GET | `/api/algo/executions` | JWT | Exécutions issues du crypto-algo |
| GET | `/api/algo/capital` | JWT | Évolution du capital crypto-algo |
| GET | `/api/algo/markets-prices` | JWT | Historique de prix des marchés surveillés |
| GET | `/api/algo/surveillance-history` | JWT | Historique des snapshots OHLC de surveillance |
| GET | `/api/algo/worker-queue-status` | JWT | État files worker (`algo-order-signals`, heartbeats) — badge UI surveillance |
| GET | `/api/algo/events` | JWT | Événements de surveillance algo (paginés, enrichis avec exécutions sim/real) |
| GET | `/api/algo/market-chart/:conditionId` | JWT | Historique ticks UP/DOWN (`AlgoPriceTick`) + métriques embarquées pour graphique UI |
| GET | `/api/algo/optimize-report` | JWT | Rapport d'optimisation algo sim live (`?closedFrom=&closedTo=`) + `configFingerprint` — voir [`rapports-analyse.md`](./rapports-analyse.md) |
| GET | `/api/market-chart/:conditionId` | JWT | Historique ticks marché non-crypto (`MarketPriceTick`) — bid/ask/mid pour graphique UI |
| POST | `/api/algo-markets/notify-changed` | — | Notification interne crypto-algo → backend (sans JWT ni service token). Publie `config-changed` + WS `algo_markets_changed`. Réservé au worker crypto-algo de confiance. |

## Rapports d'analyse (`/api/reports`)

Hub de rapports persistés (migration `0047`). Détail : [`rapports-analyse.md`](./rapports-analyse.md).

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/reports` | JWT | Liste `{ items, total }` (pagination `limit`, `offset`) |
| GET | `/api/reports/:id` | JWT | Détail rapport (payload JSON figé + métadonnées) |
| POST | `/api/reports/generate` | JWT | Génère et enregistre (`type: crypto_algo_optimize`, `params.closedFrom/To`) |
| GET | `/api/reports/compare?a=&b=` | JWT | Comparaison Δ entre deux snapshots |
| PATCH | `/api/reports/:id` | JWT | Met à jour label / note |
| DELETE | `/api/reports/:id` | JWT | Supprime (204) |

## Routes internes (`/api/internal`, `x-service-token`)

Utilisées par le worker. Principales :

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/internal/watchlist` | Watchlist (worker) |
| GET | `/api/internal/copied-positions` | Positions (worker) |
| GET | `/api/internal/trader-snapshots/:address` | Snapshots d'un trader |
| GET/PATCH | `/api/internal/move-events[/processed]` | Lecture / marquage `processed` |
| POST | `/api/internal/reconcile/:address` | Réconciliation baseline |
| POST | `/api/internal/poll-cycle/:address` | Cycle de polling |
| POST | `/api/internal/pnl-ticks` | Push des PnL ticks (→ WebSocket) |
| POST | `/api/internal/move-detected` | Notif de mouvement (→ WebSocket) |
| GET | `/api/internal/clob-credentials` | Credentials déchiffrés (trading réel) |
| GET | `/api/internal/balances` | Soldes |
| POST/DELETE | `/api/internal/position-reservations[...]` | Réservations |
| PATCH | `/api/internal/copied-positions/:id/pending-resolution` | Bascule résolution |
| POST | `/api/internal/executions/claim` | Claim idempotent d'exécution |
| POST | `/api/internal/copied-positions/:id/retry-close` | Relance de clôture |
| POST | `/api/internal/queues/:name/replay-dead` | Rejoue la dead-letter |
| POST | `/api/internal/alerts` | Alerte opérateur émise par le worker (→ bannière UI via WebSocket) |
| POST | `/api/internal/kill-switch-alert` | Alerte kill-switch spécifique (émise par le worker) |
| POST | `/api/internal/market-ticks` | Push des ticks de marché (crypto-algo → WebSocket) |
| POST | `/api/internal/algo-chart-ticks` | Push des ticks de chart algo en temps réel (crypto-algo → WebSocket `algo_chart_tick`) |
| POST | `/api/internal/market-pct-updates` | Push des variations % de marché (crypto-algo → WebSocket) |
| POST | `/api/internal/metrics/circuit-breaker` | Signalement d'événement circuit-breaker (observabilité) |
| POST | `/api/internal/metrics/exit-event` | Compteurs exit (SL/TP/trailing/pre-close/kill) — worker → Prometheus |
| POST | `/api/internal/metrics/strategy-cycle` | Durée / positions / spread du cycle stratégie |
| POST | `/api/internal/metrics/weather-question-parse` | Compteur parse questions weather |
| GET | `/api/internal/metrics/dashboard` | Agrégats dashboard metrics (service-token) |
| GET | `/api/internal/executions` | Liste des exécutions (worker) |
| POST | `/api/internal/clob-approvals/ensure` | Vérifie/soumet les 5 approbations CLOB (batch relayer) |
| POST | `/api/internal/redeem` | Rédemption on-chain CTF (`pending_resolution`) — voir [détail](#post-apiinternalredeem) ci-dessous |

### POST `/api/internal/redeem`

Rédemption on-chain des parts CTF gagnantes (même chemin que le worker `RedemptionHandler`).

**Corps JSON :**

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `conditionId` | string | oui | ID condition Polymarket (hex `0x…`) |
| `outcome` | `"YES"` \| `"NO"` | oui | Outcome gagnant à racheter |
| `quantity` | string | oui | Quantité de parts (décimales, ex. `"5.12"`) |
| `assetId` | string | oui* | Token ID CTF de la position (*sauf marchés neg-risk avec `negRisk: true`) |
| `negRisk` | boolean | non | `true` pour marchés NegRisk (encode via NegRiskAdapter) |

**Réponses typiques :**

| Cas | `success` | Effet worker |
|-----|-----------|--------------|
| Redeem OK, payout > 0 | `true` | Clôture `filled` ; wrap auto USDC.e→pUSD si applicable |
| Payout receipt = 0 | `false`, `amountRedeemedRaw: "0"` | Exec `failed`, retry (`zero_payout`) |
| Solde CTF = 0 | `no_ctf_balance` | Clôture `filled` sans nouvelle tx |
| Exec déjà en vol | — | `claimUnlessFilled` → `false` |

Validation manuelle : `npm run validate:redemption` (voir [`configuration.md`](./configuration.md)).

## Endpoints système

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/health` | Health check (`{status, database, timestamp}`) — HTTP **503** si PostgreSQL inaccessible |
| GET | `/metrics` | Métriques Prometheus (protégé par `x-service-token`) |

## WebSocket (Socket.IO)

Connexion authentifiée par token dans `handshake.auth.token`
(`packages/frontend/src/socket.ts`). À la connexion, le client rejoint les rooms
`positions`, `executions`, `alerts`, **`markets`**, **`e2e-runs`**. Le client se
reconnecte automatiquement et, sur un échec d'authentification
(`connect_error: unauthorized`), rafraîchit le JWT avant de retenter.

Évènements émis par le serveur (`packages/backend/src/websocket.ts`) :

| Évènement | Room | Charge utile |
|-----------|------|--------------|
| `position_update` | positions | Mise à jour d'une position |
| `execution` | executions | Nouvelle exécution |
| `alert` | alerts | Alerte (bannière) |
| `pnl_tick` | positions | Tick PnL d'une position |
| `market_tick` | positions | Tick carnet marché (`MarketPositionTick`, worker) |
| `market_pct_update` | markets | Variations % UP/DOWN (worker + crypto-algo) |
| `algo_chart_tick` | markets | Tick de chart en temps réel pour les marchés crypto-algo (prix UP/DOWN, spread, liquidité). Le champ `t` est un timestamp Unix ms aligné sur le `recorded_at` du tick persistant, pas sur `Date.now()` du backend. |
| `algo_markets_changed` | markets | Sélections algo modifiées (auto-track, notify-changed) |
| `move_detected` | positions | Nouveau mouvement détecté |
| `simulation_reset` | positions, executions | Réinitialisation simulation |
| `simulation_balance` | positions | Nouveau solde de simulation |
| `simulation_snapshot_created` | positions | Nouveau snapshot simulation enregistré |
| `e2e_run_started` | e2e-runs | Début d'un run E2E |
| `e2e_run_finished` | e2e-runs | Fin d'un run E2E |
| `e2e_position` | e2e-runs | Position créée dans un run E2E |
| `e2e_position_update` | e2e-runs | Mise à jour position E2E |
| `e2e_log` | e2e-runs | Ligne de log E2E |

## Weather Algo

Routes pour le trading algorithmique météo (weather-algo). Toutes requièrent un JWT.

### Sélections de marchés (legacy)

La sélection active est **par ville** (`/weather-algo-auto-track`). Les routes
ci-dessous restent pour cleanup / statut ; `POST` est retiré.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-markets` | Liste legacy (retourne `[]` en city-first) |
| POST | `/api/weather-algo-markets` | **410 Gone** — utiliser `POST /weather-algo-auto-track` |
| DELETE | `/api/weather-algo-markets/:conditionId` | Supprime une sélection legacy (204) |
| PATCH | `/api/weather-algo-markets/:conditionId` | Active/désactive `{enabled: boolean}` |
| GET | `/api/weather-algo-markets/status` | Statut runtime (`alive`, `watchedCities`, heartbeat Redis, lastSkip…) |
| POST | `/api/weather-algo-markets/notify-changed` | Interne — notifie un changement (`x-service-token`) |

### Découverte

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-discover?offset=0` | Découvre les marchés météo Polymarket (`tag_slug=weather`, page Gamma forcée à 100) → `{temperatureMarkets, allWeatherMarkets, byCity: [{city, markets, targetDate, forecastMean, forecastStdDev, forecastStatus}]}`. Le champ `byCity` groupe les marchés `highest_temp` par ville, enrichi avec la température de prédiction Open-Meteo (cache DB). |

### Auto-track (villes surveillées)

Les règles persistent une **ville** à surveiller (`highest_temp`). Le runner
sélectionne le palier à runtime. `POST /weather-algo-markets` (sélection par
sous-marché) renvoie **410 Gone**.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-auto-track` | Liste les règles (villes) |
| POST | `/api/weather-algo-auto-track` | Ajoute `{city, lookAheadDays?}` (metric forcée `highest_temp`, mode `city_follow`) |
| DELETE | `/api/weather-algo-auto-track/:id` | Supprime (204) |
| PATCH | `/api/weather-algo-auto-track/:id` | Active/désactive `{enabled: boolean}` |

### Prévisions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-forecasts/:city/:date?metric=highest_temp` | Prévision météo (cache DB → fallback Open-Meteo) |

### Capital & exécutions

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/weather-algo/capital` | JWT | Capital sim (`SimulationService.getSnapshot('weather')`) + cash réel on-chain pUSD (wallet partagé) |
| GET | `/api/weather-algo/executions` | JWT | Exécutions `WEATHER_*` (pagination `limit`/`offset`, filtres `conditionId`, `mode`, `status`/`statusGroup=pending`, `from`/`to`) — enrichi marchés + `WeatherPositionForecast` |
| GET | `/api/weather-algo/strategy-catalog` | JWT | Catalogue stratégies (`WEATHER_STRATEGY_CATALOG` : id, label, description, `supportsGroup`, `params[]`) |

### Weather Algo data (persistance / audit)

Routes JWT sous `/api/weather-algo-data`. Service : `WeatherAlgoDataService`.  
Doc : [`plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md`](./plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-data/tables` | Résumé des 7 tables (`id`, `tableName`, `rowCount`, `oldestAt`, `newestAt`) |
| DELETE | `/api/weather-algo-data/tables` | Vide les 7 tables → `{ deleted, totalDeleted }` |
| GET | `/api/weather-algo-data/forecast-history` | Liste paginée (`city`, `from`, `to`, `limit`≤500, `offset`) |
| GET | `/api/weather-algo-data/market-snapshots` | Liste (`city`, `from`, `to`, `limit`≤200) ; `includeTicks=true` pour embarquer les ticks (défaut **false**) |
| GET | `/api/weather-algo-data/bucket-ticks` | Liste (`city`, `conditionId`, `from`, `to`, `limit`≤500) |
| GET | `/api/weather-algo-data/evaluation-log` | Liste (`from`, `to`, `strategyId`, `decision`, `limit`≤500) |
| GET | `/api/weather-algo-data/forecast-cache` | Liste cache Open-Meteo opérationnel |
| GET | `/api/weather-algo-data/position-forecasts` | Liste snapshots d’entrée (+ `openedAt` joint) |
| GET | `/api/weather-algo-data/clob-price-history/timeline` | Timeline prix CLOB (`targetDate`, `city?`, `from?`, `to?`, `maxTicks?`, `fidelityMinutes?`) — filtre par intervalle |
| GET | `/api/weather-algo-data/bucket-ticks/timeline` | Timeline bucket ticks (`targetDateIso`, `city?`, `from?`, `to?`, `maxTicks?`, `fidelityMinutes?`) — filtre par intervalle |
| DELETE | `/api/weather-algo-data/bucket-ticks/interval?city=&fidelityMinutes=` | Supprime tous les ticks d'une ville à un intervalle donné → `{ city, fidelityMinutes, deleted }` |
| GET | `/api/weather-algo-data/coverage` | Agrégat legacy (période snapshots + totaux) — UI Paramètres retirée |

### Weather Algo history (ingestion historique CLOB)

Routes JWT sous `/api/weather-algo-history`. Service : `WeatherHistoryIngestService`.  
Récupère l'historique des prix YES/NO des buckets météo d'une ville sur une période, via l'API CLOB Polymarket `/prices-history` (`startTs`/`endTs` + `fidelity`), et le persiste dans `weather_clob_price_history` (upsert idempotent). Les jobs sont suivis dans `weather_history_ingest_jobs`.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/weather-algo-history/cities` | Villes connues (auto-track + snapshots + historique déjà ingéré) |
| GET | `/api/weather-algo-history/coverage?city=` | Statistiques d'ingestion d'une ville (`pointCount`, bornes `recordedAt`, `targetDates`, `intervals: [{ fidelityMinutes, pointCount }]`) |
| GET | `/api/weather-algo-history/jobs/:id` | Statut d'un job d'ingestion (polling) |
| POST | `/api/weather-algo-history/ingest` | Lance un job : `{ city, from, to, fidelityMinutes, metric? }` → `{ jobId, job }` |
| DELETE | `/api/weather-algo-history/interval?city=&fidelityMinutes=` | Supprime toutes les données d'une ville à un intervalle donné → `{ city, fidelityMinutes, deleted }` |

**Contraintes CLOB** : `startTs` + `endTs` obligatoires (sans `startTs` → HTTP 400). `startDate` est dérivé du champ Gamma `startDate` (l'API ne renvoie plus `eventStartTime`) ; en dernier recours, fenêtre de 7 jours avant `endTs`. Granularité `fidelity` en minutes (testé jusqu'à 1 min). L'historique des marchés météo quotidiens (depuis ~mars 2026) reste disponible.

**Point de settlement synthétique** : `/prices-history` ne renvoie jamais le payoff post-résolution (1.00/0.00). Pour un marché **résolu**, le service ajoute un point final synthétique (1.00 gagnant / 0.00 perdant) horodaté **après** le dernier trade, afin que le bucket gagnant atteigne 1.00. Le gagnant est détecté via `outcomePrices` (fast path, gate `closed`/`acceptingOrders`) ou via `fetchGammaMarket` (slow path, gate `gamma.resolved`). La fenêtre de fetch est étendue de `48 h` au-delà de `endDate` (`RESOLUTION_MARGIN_SEC`).

### Backtest (`/api/backtest`)

Routes JWT sous `/api/backtest`. Service : `BacktestRunService` + moteur `@polywatch/backtest`.  
Doc : [`backtest.md`](./backtest.md).

**Variables d'environnement** : `BACKTEST_TIMEOUT_MS` (défaut `1800000` = 30 min).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/backtest/data-coverage` | Couverture des données de ticks (`from`, `to`, `totalTicks`, `cities`) — `?fidelityMinutes=` optionnel pour ne compter que les ticks d'un intervalle |
| POST | `/api/backtest/runs` | Lance un run — **202** `{ id, status }` ; **409** `run_already_active` si un run weather est déjà `running`/`queued` ; **400** `invalid_params` si params Zod invalides |
| GET | `/api/backtest/runs` | Liste paginée (`domain`, `status`, `limit`≤100, `offset`) → `{ items, total }` |
| GET | `/api/backtest/runs/:id` | Détail d'un run (params, stats, warnings, plage, `error` si failed) |
| POST | `/api/backtest/runs/:id/cancel` | Cancel coopératif (si `running`/`queued`) → **200** `{ id, status: 'cancelling' }` ; le runner flush ensuite equity + positions et passe en `cancelled` (stats partielles). **400** `not_cancellable` sinon |
| DELETE | `/api/backtest/runs/:id` | Supprime le run + ses positions + son equity ; **409** `run_still_active` si le run est encore `running`/`queued` (annuler d’abord) |
| GET | `/api/backtest/runs/:id/positions` | Positions paginées (`limit`≤500, `offset`, filtre `exitReason`) |
| GET | `/api/backtest/runs/:id/equity` | Courbe d'equity `{ points: [{ t, equity, cash, openPositions }] }` (`t` = ISO timestamp) |

Paramètres de run (`POST /runs`) : `domain` (`weather`), `mode` (`reevaluate` | `replay`), `from`/`to` (ISO, `to > from`), `cities[]`, `strategyId` (défaut `weather-forecast` — **filtré en SQL** en mode `replay` ; instancie la stratégie en `reevaluate`), `backtestExecutionMode` (`strategy` | `runner-sim`, défaut `strategy` — voir [`backtest.md`](./backtest.md)), `configOverrides` (`Record<string, unknown>` — shallow merge sur `WeatherConfig` au lancement ; le snapshot/fingerprint stockés restent ceux de la config live), `capital` (défaut 1000), `entryUsdc`, `slippageBps` (défaut 50), `maxConcurrentPositions`, `detectionDelayMs` (accepté mais non appliqué → warning `detection_delay_unused` si > 0), `label`.

Config weather (`PUT /api/config/weather`) accepte `weatherAlgoStrategies` (array d'IDs catalogue, min 1) et `weatherAlgoStrategyParams` (objet par strategyId, validé contre le schéma catalogue). **Per-strategy** : chaque stratégie porte sa config complète (gates d'entrée, sizing, sorties, SL/TP/trailing, risk limits, kill-switch, pre-close) — voir [`configuration.md`](./configuration.md) § Weather Algo. Les champs legacy (`weatherAlgoMinEdge`, `weatherAlgoEntryUsdc`, …) sont **rejetés** par `weatherConfigUpdateSchema` (`.strict()`). Refonte : [`plans/applied/2026-08-11_PLAN-weather-per-strategy-config.md`](./plans/applied/2026-08-11_PLAN-weather-per-strategy-config.md).

`engine_version` du run = `BACKTEST_ENGINE_VERSION` du package (`0.2.0`+). `stats.profitFactor` peut être `null` (= +∞, aucun trade perdant).

Timeout : si `BACKTEST_TIMEOUT_MS` est dépassé, flush equity + positions puis `status=failed` / `error=timeout` (sans `statsJson`).

## Système — audit & monitor

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/system/audit` | JWT | Lance un script d'audit (`body: { script, confirm? }`) → `202 { runId }` ; `409` si déjà en cours ; scripts dangereux exigent `confirm: true` |
| GET | `/api/system/crypto-algo-monitor` | JWT | Run actif du monitor crypto-algo (`204` si aucun) — récupération UI après reload |
| POST | `/api/system/crypto-algo-monitor` | JWT | Démarre `scripts/monitor.ts` (`durationHours`, `intervalSeconds`) → `202` ; `409` si déjà en cours |
| GET | `/api/system/crypto-algo-monitor/:runId` | JWT | État + logs + dernier snapshot JSON |
| POST | `/api/system/crypto-algo-monitor/:runId/stop` | JWT | Arrête le run |

Événements WS associés : `crypto-algo-monitor:log`, `crypto-algo-monitor:snapshot`, `crypto-algo-monitor:finished`.

> Config per-kind (`GET/PUT /api/config/{global,copy,crypto,weather}`) : déjà documentée en tête de fichier (`config-per-kind.ts`).
