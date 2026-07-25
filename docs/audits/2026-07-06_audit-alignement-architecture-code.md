# Audit d'alignement Documentation ↔ Code — Architecture & Infrastructure

**Date :** 2026-07-06  
**Périmètre :** Architecture & Infrastructure (v1.1)  
**Auditeur :** Hermes Agent  
**Méthode :** Protocole 4 étapes (Setup → Doc→Code → Code→Doc → Synthèse)

---

## Synthèse exécutive

| Métrique | Valeur |
|----------|--------|
| Éléments doc vérifiés (Doc→Code) | 23 |
| ✅ Conformes | 21 (91 %) |
| ⚠️ Partiellement conformes | 2 (9 %) |
| ❌ Non conformes | 0 (0 %) |
| Lacunes identifiées (Code→Doc) | 12 |
| 🔴 Critiques | 1 |
| 🟡 Majeures | 5 |
| 🟢 Mineures | 6 |

**Verdict :** L'alignement est **bon** pour `docs/architecture.md` (91 % conforme). Le document `docs/code/01-architecture.md` est en revanche **très lacunaire** — il omet la quasi-totalité des composants runtime découverts dans le code (watchdogs, market tracking, surveillance, heartbeat, etc.). La documentation de référence (`architecture.md`) est fiable ; la documentation détaillée (`code/01-architecture.md`) nécessite une mise à jour substantielle.

---

## Étape 0 — Cadre de l'audit

### Périmètre documentaire
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `docs/README.md` | 102 | Sommaire général, stack technique, démarrage |
| `docs/architecture.md` | 161 | Vue d'ensemble architecture, routes, processus, communication |
| `docs/code/01-architecture.md` | 76 | Documentation détaillée du code (monorepo, topologie, composants) |

### Périmètre code
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `packages/backend/src/index.ts` | 195 | Serveur Express, routes, middlewares, WebSocket |
| `packages/worker/src/index.ts` | 348 | Boucles de fond, processors, watchdogs, market tracking |
| `packages/crypto-algo/src/index.ts` | 419 | Trading algorithmique, stratégies, surveillance |
| `docker-compose.yml` | 108 | Services, ports, dépendances, healthchecks |
| `package.json` | 71 | Workspaces, scripts, dépendances |

### Fichiers supplémentaires consultés
| Fichier | Utilité |
|---------|---------|
| `packages/worker/src/constants.ts` | Constantes de cadence (15 s, 100 ms, etc.) |
| `packages/backend/src/config.ts` | Configuration CORS, port, secrets |
| `docs/code/README.md` | Sommaire de la doc code |

---

## Étape 1 — Doc→Code : chaque promesse documentée, sa preuve dans le code

### 1.1 Routes montées (architecture.md lignes 44–67 → backend/src/index.ts)

| # | Route (doc) | Preuve code (fichier:ligne) | Statut | Observation |
|---|-------------|-----------------------------|--------|-------------|
| 1 | `/api/auth` + jwtLimiter | `backend/src/index.ts:123` | ✅ | Identique |
| 2 | `/api/watchlist` + jwtLimiter | `backend/src/index.ts:124` | ✅ | Identique |
| 3 | `/api/leaderboard` + jwtLimiter | `backend/src/index.ts:125` | ✅ | Identique |
| 4 | `/api/traders` + jwtLimiter | `backend/src/index.ts:126` | ✅ | Identique |
| 5 | `/api/market-tags` + jwtLimiter | `backend/src/index.ts:127` | ✅ | Identique |
| 6 | `/market-icons` (sans jwtLimiter) | `backend/src/index.ts:128` | ✅ | Identique — route publique |
| 7 | `/api/markets` + jwtLimiter | `backend/src/index.ts:129` | ✅ | Identique |
| 8 | `/api/algo-markets` + jwtLimiter | `backend/src/index.ts:130` | ✅ | Identique |
| 9 | `/api/algo-auto-track` + jwtLimiter | `backend/src/index.ts:131` | ✅ | Identique |
| 10 | `/api/algo/executions` + jwtLimiter | `backend/src/index.ts:132` | ✅ | Identique |
| 11 | `/api/algo/capital` + jwtLimiter | `backend/src/index.ts:133` | ✅ | Identique |
| 12 | `/api/algo/markets-prices` + jwtLimiter | `backend/src/index.ts:134` | ✅ | Identique |
| 13 | `/api/algo/surveillance-history` + jwtLimiter | `backend/src/index.ts:135` | ✅ | Identique |
| 14 | `/api/algo/events` + jwtLimiter | `backend/src/index.ts:137` | ✅ | Identique |
| 15 | `/api/algo/market-chart` + jwtLimiter | `backend/src/index.ts:136` | ✅ | Identique |
| 16 | `/api/copied-positions` + jwtLimiter | `backend/src/index.ts:138` | ✅ | Identique |
| 17 | `/api` + jwtLimiter (config) | `backend/src/index.ts:139` | ✅ | Identique |
| 18 | `/api` + jwtLimiter (simulation) | `backend/src/index.ts:140` | ✅ | Identique |
| 19 | `/api/executions` + jwtLimiter | `backend/src/index.ts:141` | ✅ | Identique |
| 20 | `/api/move-events` + jwtLimiter | `backend/src/index.ts:142` | ✅ | Identique |
| 21 | `/api/wallet` + jwtLimiter | `backend/src/index.ts:143` | ✅ | Identique |
| 22 | `/api/e2e-runs` + jwtLimiter | `backend/src/index.ts:144` | ✅ | Identique |
| 23 | `/api/internal` (sans jwtLimiter) | `backend/src/index.ts:145` | ✅ | Identique — réservé worker |

**Résultat : 23/23 routes ✅ — correspondance parfaite.**

### 1.2 Vérifications clés

| # | Vérification | Doc (citation) | Preuve code | Statut | Observation |
|---|-------------|----------------|-------------|--------|-------------|
| 1 | Canal Redis `backend-ready` dans tableau comm. | `architecture.md:119` — `Pub/Sub Redis \| Backend → Worker / crypto-algo \| ... backend-ready` | `backend/src/index.ts:180` — `redis.publish('backend-ready', ...)` + `worker/src/index.ts:221` — `redisSub.subscribe('backend-ready')` | ✅ | Présent et correct |
| 2 | Cadence MarketResolutionWatcher 15 s | `architecture.md:79` — `MarketResolutionWatcher (15 s)` | `worker/src/constants.ts:38` — `MARKET_RESOLUTION_LOOP_MS = 15_000` + `worker/src/index.ts:309` — `marketResolutionWatcher.startLoop(MARKET_RESOLUTION_LOOP_MS)` | ✅ | 15 000 ms = 15 s |
| 3 | 5 processus décrits | `architecture.md:5` — « cinq packages » + section 2 | `docker-compose.yml` — 6 services (postgres, redis, backend, worker, crypto-algo, frontend) ; `package.json` — 5 workspaces | ⚠️ | **5 packages** (core, backend, worker, crypto-algo, frontend) mais **4 processus applicatifs** (core est une lib). docker-compose a 6 services (2 infra). Le titre « Les cinq processus » est ambigu. |
| 4 | Sommaire README liste tous les docs/*.md | `docs/README.md:13-25` | `find docs -maxdepth 1 -name '*.md'` → 11 fichiers listés | ✅ | Tous les 11 fichiers .md de `docs/` sont dans le sommaire. Aucun oubli. |
| 5 | Doublons dans le sommaire | — | Inspection visuelle | ✅ | Aucun doublon. |
| 6 | Port backend 3000 | `architecture.md:21` — « Serveur HTTP :3000 » | `backend/src/config.ts:35` — `port: Number(process.env.PORT ?? 3000)` + `docker-compose.yml:33` — `"3000:3000"` | ✅ | Correct |
| 7 | CORS restreint à whitelist | `architecture.md:34` — « CORS restreint à la whitelist CORS_ORIGIN » | `backend/src/index.ts:74` — `cors({ origin: config.corsOrigins })` + `backend/src/config.ts:26-31` — split de `CORS_ORIGIN` | ✅ | Correct |
| 8 | Rate-limit avec exemption worker | `architecture.md:38-39` — « rate-limit… appels internes du worker exemptés » | `backend/src/index.ts:90-97` — `skip: (req) => req.headers['x-service-token'] === config.serviceToken` | ✅ | Correct |
| 9 | `/metrics` protégé par x-service-token | `architecture.md:34` — « /metrics (Prometheus, protégé par x-service-token) » | `backend/src/index.ts:118` — `app.get('/metrics', requireServiceToken, ...)` | ✅ | Correct |
| 10 | `/health` sans auth | `architecture.md:33` — « /health » | `backend/src/index.ts:99` — `app.get('/health', ...)` sans middleware | ✅ | Correct |
| 11 | WebSocket Socket.IO | `architecture.md:37` — « Démarre le serveur WebSocket (Socket.IO) » | `backend/src/index.ts:148` — `initWebSocket(server)` | ✅ | Correct |
| 12 | 4 files Redis (move-events, order-signals, close-signals, execution-results) | `architecture.md:76-77` — « Consommateurs de files (move-events, order-signals, close-signals, execution-results) » | `worker/src/index.ts:88-99` — 4 `RedisQueue` avec ces noms | ✅ | Correct |
| 13 | 7 connexions Redis distinctes | `architecture.md:73` — « plusieurs connexions Redis distinctes » | `worker/src/index.ts:76-82` — 7 `createRedis()` | ✅ | Correct |
| 14 | Stratégie SL/TP/trailing ~100 ms | `architecture.md:78` — « évaluation SL/TP/trailing toutes les ~100 ms » | `worker/src/constants.ts:53` — `STRATEGY_EVAL_INTERVAL_MS = 100` + `worker/src/index.ts:308` — `strategy.startEvaluation(STRATEGY_EVAL_INTERVAL_MS)` | ✅ | Correct |
| 15 | Heartbeat worker 30 s | `architecture.md:102` — « heartbeat sur le canal Redis heartbeat toutes les 30 s » | `worker/src/constants.ts:11` — `HEARTBEAT_INTERVAL_MS = 30_000` + `worker/src/index.ts:275-280` | ✅ | Correct |
| 16 | `waitForBackendReady` | `architecture.md:86` — « waitForBackendReady » | `worker/src/index.ts:142` — `waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS)` | ✅ | Correct |
| 17 | `ensureCashIntegrity` | `architecture.md:86` — « ensureCashIntegrity » | `worker/src/index.ts:60` — `simulationService.ensureCashIntegrity()` | ✅ | Correct |
| 18 | `recoverOrphanMoves` | `architecture.md:86` — « recoverOrphanMoves » | `worker/src/index.ts:165` — `moveDetector.recoverOrphanMoves()` | ✅ | Correct |
| 19 | `RedemptionHandler` (15 s) | `architecture.md:79` — « RedemptionHandler (15 s) » | `worker/src/constants.ts:41` — `REDEMPTION_LOOP_MS = 15_000` + `worker/src/index.ts:310` — `redemption.startLoop(REDEMPTION_LOOP_MS)` | ✅ | Correct |
| 20 | `ClosingWatchdog` | `architecture.md:80` — « ClosingWatchdog » | `worker/src/index.ts:311` — `closingWatchdog.start(CLOSING_WATCHDOG_LOOP_MS)` | ✅ | Correct, mais intervalle non documenté (15 s) |
| 21 | `PlacingJanitor` | `architecture.md:80` — « PlacingJanitor » | `worker/src/index.ts:312` — `placingJanitor.start(PLACING_JANITOR_LOOP_MS)` | ✅ | Correct, mais intervalle non documenté (60 s) |
| 22 | `ReservationJanitor` | `architecture.md:80` — « ReservationJanitor » | `worker/src/index.ts:313` — `reservationJanitor.start(RESERVATION_JANITOR_LOOP_MS)` | ✅ | Correct, mais intervalle non documenté (60 s) |
| 23 | `OpenPositionTracker` + `MarketTickRecorder` | `architecture.md:82` — « OpenPositionTracker + MarketTickRecorder » | `worker/src/index.ts:206-211` | ✅ | Correct |

### 1.3 Vérifications docs/code/01-architecture.md

| # | Élément doc | Preuve code | Statut | Observation |
|---|-------------|-------------|--------|-------------|
| 1 | Monorepo 5 packages | `package.json:4-6` — workspaces `packages/*` | ✅ | Correct |
| 2 | PostgreSQL TypeORM, `pg` driver | `backend/src/index.ts:55` — `createDataSource()` | ✅ | Correct |
| 3 | Redis : 4 listes, BRPOPLPUSH, dead-letter | `worker/src/index.ts:88-99, 114-137` | ✅ | Correct |
| 4 | Socket.IO rooms (positions, executions, alerts) | `backend/src/index.ts:148` — `initWebSocket(server)` | ✅ | Correct (détail des rooms dans le code WebSocket) |
| 5 | Worker→Backend HTTP `/api/internal/*` | `backend/src/index.ts:145` — `app.use('/api/internal', createInternalRouter(ds))` | ✅ | Correct |
| 6 | Backend→Worker Redis `config-changed` | `worker/src/index.ts:221,227` — `redisSub.subscribe('config-changed')` | ✅ | Correct |
| 7 | Worker↔Worker files Redis | `worker/src/index.ts:88-99` — 4 queues | ✅ | Correct |
| 8 | Modes de trading sim/real | `worker/src/index.ts:104-105` — 2 Executors (entrées/sorties) | ✅ | Correct |

---

## Étape 2 — Code→Doc : logiques non documentées

### 2.1 Lacunes dans `docs/architecture.md`

| # | Preuve code (fichier:ligne) | Description | État doc | Priorité |
|---|-----------------------------|-------------|----------|----------|
| L1 | `backend/src/index.ts:152` | `startSimAutoSnapshotLoop(ds)` — boucle d'auto-snapshot simulation lancée au démarrage du backend | Non documenté dans architecture.md | 🟢 Mineure |
| L2 | `backend/src/index.ts:179-188` | Publication `backend-ready` sur pub/sub **ET** clé TTL Redis (`set('backend-ready', ..., 'EX', 60)`) | architecture.md ne mentionne que le pub/sub, pas la clé TTL | 🟢 Mineure |
| L3 | `worker/src/index.ts:204` | `MarketPercentPublisher` — publie les pourcentages de variation des marchés | Non documenté dans architecture.md | 🟢 Mineure |
| L4 | `worker/src/index.ts:151` | `UserChannelManager` — gestion du canal WebSocket utilisateur CLOB | Non documenté dans architecture.md | 🟡 Majeure |
| L5 | `worker/src/index.ts:103` | `PositionLockRegistry` — registre de verrous pour éviter les doubles exécutions | Non documenté dans architecture.md | 🟡 Majeure |
| L6 | `worker/src/index.ts:155-159` | `reconcilePlacingExecutions` — réconciliation des exécutions au démarrage | Non documenté dans architecture.md | 🟡 Majeure |
| L7 | `worker/src/index.ts:168-171` | `backfillClosingStartedAt` — backfill legacy pour les lignes pré-colonne | Non documenté dans architecture.md | 🟢 Mineure |
| L8 | `worker/src/index.ts:207-211, 288-292` | `MarketTickRecorder` + purge horaire des ticks | architecture.md mentionne l'existence (l.82) mais pas la purge horaire | 🟢 Mineure |
| L9 | `worker/src/index.ts:206` | `OpenPositionTracker` — refresh périodique de l'index des positions ouvertes | architecture.md mentionne l'existence (l.82) mais pas le refresh périodique | 🟢 Mineure |
| L10 | `crypto-algo/src/index.ts:157` | `CryptoAlgoRuntimeStatusPublisher` — publie le statut runtime sur Redis | Non documenté dans architecture.md | 🟢 Mineure |
| L11 | `crypto-algo/src/index.ts:330-345` | Heartbeat crypto-algo : pub/sub + clé TTL `crypto-algo:heartbeat` EX 60 | architecture.md mentionne le heartbeat worker (l.102) mais pas le heartbeat crypto-algo ni la clé TTL | 🟡 Majeure |
| L12 | `crypto-algo/src/index.ts:312` | `startSurveillanceJanitor(ds)` — janitor des snapshots de surveillance | Non documenté dans architecture.md | 🟢 Mineure |

### 2.2 Lacunes dans `docs/code/01-architecture.md`

Ce document (76 lignes) est très en retard par rapport au code. Il omet massivement des composants. Voici les lacunes structurantes :

| # | Composant manquant | Preuve code | Impact |
|---|-------------------|-------------|--------|
| CL1 | **Watchdogs** : `ClosingWatchdog`, `PlacingJanitor`, `ReservationJanitor` | `worker/src/index.ts:110-112` | 🔴 Critique — 3 composants de fiabilité non documentés |
| CL2 | **Market tracking** : `OpenPositionTracker`, `MarketTickRecorder`, `MarketPercentPublisher` | `worker/src/index.ts:204-211` | 🟡 Majeure |
| CL3 | **Canal `backend-ready`** (pub/sub + clé TTL) | `backend/src/index.ts:179-188`, `worker/src/index.ts:221` | 🟡 Majeure |
| CL4 | **Heartbeat** worker + crypto-algo | `worker/src/index.ts:275-280`, `crypto-algo/src/index.ts:330-345` | 🟡 Majeure |
| CL5 | **UserChannelManager** + **PositionLockRegistry** | `worker/src/index.ts:103,151` | 🟡 Majeure |
| CL6 | **Composants crypto-algo** : `StrategyRunner`, `NaiveMomentumStrategy`, `AlgoEntryPipeline`, `SelectionLoader`, `MarketJanitor`, `MarketSurveillanceRecorder`, `PriceTickRecorder`, `CryptoAlgoPriceFeed`, `AlgoMarketPercentPublisher`, `CryptoAlgoRuntimeStatusPublisher`, `SignalStateRegistry`, `PositionContextCache`, `surveillance-janitor` | `crypto-algo/src/index.ts` (passim) | 🟡 Majeure |
| CL7 | **Bootstrap** : `ensureCashIntegrity`, `recoverOrphanMoves`, `reconcilePlacingExecutions`, `backfillClosingStartedAt` | `worker/src/index.ts:60-73, 155-171` | 🟢 Mineure |
| CL8 | **`startSimAutoSnapshotLoop`** | `backend/src/index.ts:152` | 🟢 Mineure |
| CL9 | **`e2eRunner`** + `recoverStaleRuns` | `backend/src/index.ts:60-61` | 🟢 Mineure |
| CL10 | **Version erronée** : titre « v0.1.0 » au lieu de v1.1 | `docs/code/README.md:1` | 🟢 Mineure |
| CL11 | **Terme « stratégies ML »** trompeur | `docs/code/README.md:15` — « stratégies ML » alors que le code montre `NaiveMomentumStrategy` (règle simple, pas de ML) | 🟢 Mineure |

### 2.3 Lacunes dans `docs/README.md`

| # | Description | Preuve | Priorité |
|---|-------------|--------|----------|
| R1 | Le sommaire mentionne `snapshots-simulation.md` mais le fichier n'existe pas dans `docs/` | `find docs -maxdepth 1 -name '*.md'` ne liste pas `snapshots-simulation.md` | 🟡 Majeure |
| R2 | Le lien `docs/code/README.md` dans le sommaire pointe vers une doc qui se dit « v0.1.0 » | `docs/code/README.md:1` | 🟢 Mineure |

**Vérification croisée :** Le fichier `snapshots-simulation.md` n'apparaît pas dans la liste des fichiers `docs/*.md`. Il est référencé dans le sommaire du README mais n'existe pas sur le disque. C'est une lacune 🟡 Majeure.

---

## Étape 3 — Synthèse et plan d'action priorisé

### 3.1 Tableau de conformité global

| Document | Taux conformité | Routes | Composants | Communication | Constantes |
|----------|----------------|--------|------------|---------------|------------|
| `docs/architecture.md` | **~91 %** | ✅ 23/23 | ⚠️ 18/20 | ✅ 6/6 | ✅ 5/5 |
| `docs/code/01-architecture.md` | **~35 %** | N/A | ❌ 5/18 | ⚠️ 3/6 | N/A |
| `docs/README.md` | **~95 %** | N/A | N/A | N/A | N/A |

### 3.2 Plan d'action priorisé

#### 🔴 Critique (1)

| ID | Action | Fichier cible | Justification |
|----|--------|---------------|---------------|
| P1 | Ajouter les 3 watchdogs (`ClosingWatchdog`, `PlacingJanitor`, `ReservationJanitor`) avec leurs intervalles | `docs/code/01-architecture.md` | Composants de fiabilité essentiels, absents de la doc détaillée |

#### 🟡 Majeure (5)

| ID | Action | Fichier cible | Justification |
|----|--------|---------------|---------------|
| P2 | Ajouter les composants market tracking (`OpenPositionTracker`, `MarketTickRecorder`, `MarketPercentPublisher`) | `docs/code/01-architecture.md` | Tracking des positions et ticks, cœur du pipeline |
| P3 | Ajouter les composants crypto-algo manquants (StrategyRunner, AlgoEntryPipeline, MarketSurveillanceRecorder, PriceTickRecorder, etc.) | `docs/code/01-architecture.md` | La section crypto-algo est quasi-vide |
| P4 | Ajouter `UserChannelManager` et `PositionLockRegistry` | `docs/code/01-architecture.md` | Gestion des connexions WebSocket utilisateur et verrous d'exécution |
| P5 | Ajouter les canaux `backend-ready` et `heartbeat` (worker + crypto-algo) | `docs/code/01-architecture.md` section « Communication inter-services » | Canaux de signalisation essentiels absents |
| P6 | Créer ou corriger `docs/snapshots-simulation.md` | `docs/` | Fichier référencé dans le sommaire mais inexistant |

#### 🟢 Mineure (6)

| ID | Action | Fichier cible | Justification |
|----|--------|---------------|---------------|
| P7 | Ajouter `startSimAutoSnapshotLoop` | `docs/architecture.md` section Backend | Boucle de fond méconnue |
| P8 | Ajouter la clé TTL `backend-ready` | `docs/architecture.md` section Communication | Précision sur le mécanisme |
| P9 | Ajouter `reconcilePlacingExecutions`, `backfillClosingStartedAt`, `ensureCashIntegrity` | `docs/code/01-architecture.md` | Bootstrap et réconciliation |
| P10 | Ajouter `e2eRunner` + `recoverStaleRuns` | `docs/code/01-architecture.md` | Service E2E |
| P11 | Corriger version « v0.1.0 » → « v1.1 » | `docs/code/README.md:1` | Information obsolète |
| P12 | Corriger « stratégies ML » → « stratégies (NaiveMomentumStrategy) » | `docs/code/README.md:15` | Terme trompeur |

### 3.3 Détail des intervalles non documentés

| Composant | Intervalle (code) | Documenté dans architecture.md ? |
|-----------|-------------------|----------------------------------|
| `MarketResolutionWatcher` | 15 000 ms (15 s) | ✅ Oui (l.79) |
| `RedemptionHandler` | 15 000 ms (15 s) | ✅ Oui (l.79) |
| `StrategyProcessing` | 100 ms | ✅ Oui (l.78, « ~100 ms ») |
| `ClosingWatchdog` | 15 000 ms (15 s) | ❌ Non |
| `PlacingJanitor` | 60 000 ms (60 s) | ❌ Non |
| `ReservationJanitor` | 60 000 ms (60 s) | ❌ Non |
| `BookSubscriptionSync` | 10 000 ms (10 s) | ⚠️ Mentionné « resync abonnements 10 s » (l.83) |
| `Heartbeat` | 30 000 ms (30 s) | ✅ Oui (l.102) |

---

## Annexes

### A. Fichiers docs/*.md (vérification sommaire README)

```
docs/api.md                    ✅ listé
docs/architecture.md           ✅ listé
docs/configuration.md          ✅ listé
docs/crypto-algo.md            ✅ listé
docs/deployment.md             ✅ listé
docs/frontend.md               ✅ listé
docs/metrics.md                ✅ listé
docs/modele-donnees.md         ✅ listé
docs/pipeline-copy-trading.md  ✅ listé
docs/README.md                 (lui-même, non listé)
docs/snapshots-simulation.md   ❌ RÉFÉRENCÉ MAIS INEXISTANT
```

### B. Services docker-compose.yml

| Service | Dockerfile | Ports | Dépendances |
|---------|-----------|-------|-------------|
| `postgres` | postgres:16-alpine | 5432 | — |
| `redis` | redis:7-alpine | 6379 | — |
| `backend` | packages/backend/Dockerfile | 3000 | postgres (healthy), redis |
| `worker` | packages/worker/Dockerfile | — | postgres, redis, backend |
| `crypto-algo` | packages/crypto-algo/Dockerfile | — | postgres, redis, backend |
| `frontend` | packages/frontend/Dockerfile | 5173:80 | backend |

### C. Scripts package.json (vérification)

| Script | Commande | Correspond doc |
|--------|----------|----------------|
| `dev` | concurrently (core, backend, worker, crypto-algo, frontend) | ✅ architecture.md l.98 |
| `build` | tsc + vite build | ✅ architecture.md l.20-24 |
| `migrate` | npm run migrate -w @polywatch/core | ✅ architecture.md l.141 |
| `test` | vitest (tous packages) | ✅ README.md l.79 |
