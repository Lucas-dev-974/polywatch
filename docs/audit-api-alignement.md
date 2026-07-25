# Rapport d'Audit — Alignement Documentation ↔ Code Source
## Périmètre API REST & WebSocket — Polywatch v1.1

**Date** : 2026-07-06  
**Périmètre doc** : `docs/api.md` (231 lignes), `docs/code/05-backend.md` (99 lignes)  
**Périmètre code** : `packages/backend/src/index.ts`, `routes/*.ts`, `websocket.ts`, `middleware/auth.ts`  
**Protocole** : 4 étapes (Setup → Doc→Code → Code→Doc → Synthèse)

---

## Résumé Exécutif

| Métrique | Valeur |
|---|---|
| Routes documentées | 67 |
| Routes documentées **confirmées dans le code** | 66 |
| Routes documentées **absentes du code** | **1** |
| Routes réelles **non documentées** | **18** |
| Événements WebSocket documentés | 16 |
| Événements WebSocket **confirmés dans le code** | 16 |
| Événements WebSocket **non documentés** | 0 |
| Rooms Socket.IO documentées | 5 |
| Rooms Socket.IO **confirmées** | 5 |
| **Taux d'alignement global** | **~78 %** |

---

## 1. Setup (Étape 1)

Fichiers lus et analysés :

| Fichier | Lignes | Rôle |
|---|---|---|
| `docs/api.md` | 231 | Référence API complète |
| `docs/code/05-backend.md` | 99 | Documentation architecture backend |
| `packages/backend/src/index.ts` | 195 | Bootstrap Express + montage des routes |
| `packages/backend/src/websocket.ts` | 108 | Émetteurs Socket.IO |
| `packages/backend/src/middleware/auth.ts` | 38 | `requireJwt` + `requireServiceToken` |
| `routes/auth.ts` | 107 | Login / Refresh |
| `routes/watchlist.ts` | 121 | CRUD watchlist + settings |
| `routes/positions.ts` | 165 | Positions copiées + ticks |
| `routes/config.ts` | 344 | Risk config, CLOB credentials, Polygonscan |
| `routes/simulation.ts` | 328 | Simulation + analytics |
| `routes/executions.ts` | 76 | Exécutions |
| `routes/move-events.ts` | 43 | Mouvements traders |
| `routes/leaderboard.ts` | 57 | Leaderboard |
| `routes/trader-insight.ts` | 282 | Insight traders |
| `routes/market-tags.ts` | 49 | Tags Gamma |
| `routes/market-icons.ts` | 68 | Icônes proxy |
| `routes/markets.ts` | 151 | Marchés + metrics + ticks |
| `routes/algo-markets.ts` | 121 | Sélections algo + notify-changed |
| `routes/algo-auto-track.ts` | 121 | Règles d'auto-track |
| `routes/algo-executions.ts` | 49 | Exécutions algo |
| `routes/algo-capital.ts` | 70 | Capital algo |
| `routes/algo-markets-prices.ts` | 192 | Prix marchés algo |
| `routes/algo-surveillance-history.ts` | 17 | Historique surveillance |
| `routes/algo-events.ts` | 30 | Événements algo |
| `routes/algo-market-chart.ts` | 47 | Graphique ticks UP/DOWN |
| `routes/wallet.ts` | 302 | Wallet + bridge + withdraw |
| `routes/wallet-accounts.ts` | 165 | Comptes wallet |
| `routes/e2e-runs.ts` | 154 | Runs E2E |
| `routes/internal.ts` | 26 | Router interne (dispatch) |
| `routes/internal/watchlist-routes.ts` | 113 | Routes internes watchlist |
| `routes/internal/positions-routes.ts` | 163 | Routes internes positions |
| `routes/internal/queue-routes.ts` | 20 | Routes internes queues |
| `routes/internal/clob-ops-routes.ts` | 107 | Routes internes CLOB |

---

## 2. Doc→Code (Étape 2) — Routes documentées → existantes dans le code

### 2.1 Authentification — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `POST /api/auth/login` | api.md:16 | auth.ts:49 | ✅ |
| `POST /api/auth/refresh` | api.md:17 | auth.ts:67 | ✅ |

### 2.2 Watchlist — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/watchlist` | api.md:28 | watchlist.ts:46 | ✅ |
| `POST /api/watchlist` | api.md:29 | watchlist.ts:71 | ✅ |
| `PATCH /api/watchlist/:id` | api.md:30 | watchlist.ts:90 | ✅ |
| `DELETE /api/watchlist/:id` | api.md:31 | watchlist.ts:114 | ✅ |

### 2.3 Positions copiées — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/copied-positions` | api.md:37 | positions.ts:56 | ✅ |
| `POST /api/copied-positions/:id/close` | api.md:38 | positions.ts:129 | ✅ |

### 2.4 Configuration / Simulation / CLOB — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/risk-config` | api.md:46 | config.ts:176 | ✅ |
| `PUT /api/risk-config` | api.md:47 | config.ts:180 | ✅ |
| `GET /api/market-tags` | api.md:48 | market-tags.ts:23 | ✅ |
| `GET /api/simulation-balance` | api.md:49 | simulation.ts:245 | ✅ |
| `POST /api/simulation-balance/reset` | api.md:50 | simulation.ts:249 | ✅ |
| `GET /api/simulation-snapshots` | api.md:51 | simulation.ts:268 | ✅ |
| `POST /api/simulation-snapshots` | api.md:52 | simulation.ts:289 | ✅ |
| `GET /api/simulation-snapshots/:id` | api.md:53 | simulation.ts:313 | ✅ |
| `DELETE /api/simulation-snapshots` | api.md:54 | simulation.ts:306 | ✅ |
| `GET /api/clob-credentials/status` | api.md:55 | config.ts:224 | ✅ |
| `POST /api/clob-credentials` | api.md:56 | config.ts:247 | ✅ |
| `DELETE /api/clob-credentials` | api.md:57 | config.ts:277 | ✅ |

### 2.5 Exécutions — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/executions` | api.md:63 | executions.ts:19 | ✅ |
| `POST /api/executions` (x-service-token) | api.md:64 | executions.ts:59 | ✅ |

### 2.6 Runs E2E — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `POST /api/e2e-runs` | api.md:70 | e2e-runs.ts:106 | ✅ |
| `GET /api/e2e-runs` | api.md:71 | e2e-runs.ts:65 | ✅ |
| `GET /api/e2e-runs/:id` | api.md:72 | e2e-runs.ts:97 | ✅ |

### 2.7 Mouvements de traders — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/move-events` | api.md:78 | move-events.ts:18 | ✅ |
| `DELETE /api/move-events` | api.md:79 | move-events.ts:37 | ✅ |

### 2.8 Leaderboard — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/leaderboard` | api.md:85 | leaderboard.ts:29 | ✅ |

### 2.9 Wallet — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/wallet` | api.md:93 | wallet.ts:76 | ✅ |
| `POST /api/wallet/pusd/withdraw` | api.md:94 | wallet.ts:139 | ✅ |
| `POST /api/wallet/pusd/withdraw/prepare` | api.md:95 | wallet.ts:182 | ✅ |
| `POST /api/wallet/pusd/withdraw/submit` | api.md:96 | wallet.ts:211 | ✅ |
| `GET /api/wallet/bridge/supported-assets` | api.md:97 | wallet.ts:231 | ✅ |
| `POST /api/wallet/bridge/deposit-addresses` | api.md:98 | wallet.ts:239 | ✅ |
| `POST /api/wallet/bridge/deposit-quote` | api.md:99 | wallet.ts:256 | ✅ |
| `GET /api/wallet/bridge/status/:address` | api.md:100 | wallet.ts:287 | ✅ |

### 2.10 Wallet Accounts — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/wallet/accounts` | api.md:109 | wallet-accounts.ts:50 | ✅ |
| `POST /api/wallet/accounts` | api.md:110 | wallet-accounts.ts:59 | ✅ |
| `PUT /api/wallet/accounts/:id` | api.md:111 | wallet-accounts.ts:83 | ✅ |
| `GET /api/wallet/accounts/:id/history` | api.md:112 | wallet-accounts.ts:118 | ✅ |
| `DELETE /api/wallet/accounts/:id` | api.md:113 | wallet-accounts.ts:150 | ✅ |

### 2.11 Marchés — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/markets` | api.md:119 | markets.ts:45 | ✅ |
| `GET /api/markets/:conditionId/metrics` | api.md:120 | markets.ts:85 | ✅ |

### 2.12 Trader Insight — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/traders/:address/insight` | api.md:130 | trader-insight.ts:126 | ✅ |

### 2.13 Icônes — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /market-icons/:conditionId` | api.md:140 | market-icons.ts:15 | ✅ |

### 2.14 Crypto-Algo — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/algo-markets` | api.md:149 | algo-markets.ts:29 | ✅ |
| `POST /api/algo-markets` | api.md:150 | algo-markets.ts:33 | ✅ |
| `DELETE /api/algo-markets/:conditionId` | api.md:151 | algo-markets.ts:51 | ✅ |
| `PATCH /api/algo-markets/:conditionId` | api.md:152 | algo-markets.ts:59 | ✅ |
| `GET /api/algo-markets/status` | api.md:153 | algo-markets.ts:77 | ✅ |
| `GET /api/algo-auto-track` | api.md:154 | algo-auto-track.ts:43 | ✅ |
| `POST /api/algo-auto-track` | api.md:155 | algo-auto-track.ts:47 | ✅ |
| `DELETE /api/algo-auto-track/:id` | api.md:156 | algo-auto-track.ts:90 | ✅ |
| `PATCH /api/algo-auto-track/:id` | api.md:157 | algo-auto-track.ts:97 | ✅ |
| `GET /api/algo/executions` | api.md:158 | algo-executions.ts:16 | ✅ |
| `GET /api/algo/capital` | api.md:159 | algo-capital.ts:30 | ✅ |
| `GET /api/algo/markets-prices` | api.md:160 | algo-markets-prices.ts:137 | ✅ |
| `GET /api/algo/surveillance-history` | api.md:161 | algo-surveillance-history.ts:10 | ✅ |
| `GET /api/algo/events` | api.md:162 | algo-events.ts:15 | ✅ |
| `GET /api/algo/market-chart/:conditionId` | api.md:163 | algo-market-chart.ts:28 | ✅ |
| `POST /api/algo-markets/notify-changed` | api.md:164 | algo-markets.ts:114 | ✅ |

### 2.15 Routes Internes — ⚠️ 1 route absente

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /api/internal/watchlist` | api.md:172 | internal/watchlist-routes.ts:25 | ✅ |
| `GET /api/internal/copied-positions` | api.md:173 | internal/positions-routes.ts:26 | ✅ |
| `GET /api/internal/trader-snapshots/:address` | api.md:174 | internal/clob-ops-routes.ts:16 | ✅ |
| `GET/PATCH /api/internal/move-events[/processed]` | api.md:175 | internal/watchlist-routes.ts:53,77 | ✅ |
| `POST /api/internal/reconcile/:address` | api.md:176 | internal/watchlist-routes.ts:61 | ✅ |
| `POST /api/internal/poll-cycle/:address` | api.md:177 | internal/watchlist-routes.ts:69 | ✅ |
| `POST /api/internal/pnl-ticks` | api.md:178 | internal/watchlist-routes.ts:82 | ✅ |
| `POST /api/internal/move-detected` | api.md:179 | internal/watchlist-routes.ts:107 | ✅ |
| `GET /api/internal/clob-credentials` | api.md:180 | internal/clob-ops-routes.ts:23 | ✅ |
| `GET /api/internal/balances` | api.md:181 | internal/positions-routes.ts:40 | ✅ |
| `POST/DELETE /api/internal/position-reservations[...]` | api.md:182 | internal/positions-routes.ts:62,71 | ✅ |
| `PATCH /api/internal/copied-positions/:id/pending-resolution` | api.md:183 | internal/positions-routes.ts:76 | ✅ |
| `POST /api/internal/executions/claim` | api.md:184 | internal/positions-routes.ts:89 | ✅ |
| **`PATCH /api/internal/executions/:orderSignalId`** | **api.md:185** | **❌ ABSENT** | **🔴** |
| `POST /api/internal/copied-positions/:id/retry-close` | api.md:186 | internal/positions-routes.ts:102 | ✅ |
| `POST /api/internal/queues/:name/replay-dead` | api.md:187 | internal/queue-routes.ts:8 | ✅ |
| `POST /api/internal/alerts` | api.md:188 | internal/watchlist-routes.ts:29 | ✅ |
| `POST /api/internal/kill-switch-alert` | api.md:189 | internal.ts:20 | ✅ |
| `POST /api/internal/market-ticks` | api.md:190 | internal/watchlist-routes.ts:88 | ✅ |
| `POST /api/internal/market-pct-updates` | api.md:191 | internal/watchlist-routes.ts:94 | ✅ |
| `POST /api/internal/metrics/circuit-breaker` | api.md:192 | internal/watchlist-routes.ts:39 | ✅ |
| `GET /api/internal/executions` | api.md:193 | internal/positions-routes.ts:153 | ✅ |
| `POST /api/internal/clob-approvals/ensure` | api.md:194 | internal/clob-ops-routes.ts:32 | ✅ |
| `POST /api/internal/redeem` | api.md:195 | internal/clob-ops-routes.ts:50 | ✅ |

### 2.16 Endpoints système — ✅ Aligné

| Route | Doc | Code | Statut |
|---|---|---|---|
| `GET /health` | api.md:201 | index.ts:99 | ✅ |
| `GET /metrics` | api.md:202 | index.ts:118 | ✅ |

### 2.17 WebSocket — ✅ Aligné

| Événement | Doc | Code | Statut |
|---|---|---|---|
| `position_update` | api.md:216 | websocket.ts:37 | ✅ |
| `execution` | api.md:217 | websocket.ts:41 | ✅ |
| `alert` | api.md:218 | websocket.ts:45 | ✅ |
| `pnl_tick` | api.md:219 | websocket.ts:48 | ✅ |
| `market_tick` | api.md:220 | websocket.ts:54 | ✅ |
| `market_pct_update` | api.md:221 | websocket.ts:60 | ✅ |
| `algo_markets_changed` | api.md:222 | websocket.ts:82 | ✅ |
| `move_detected` | api.md:223 | websocket.ts:65 | ✅ |
| `simulation_reset` | api.md:224 | websocket.ts:69 | ✅ |
| `simulation_balance` | api.md:225 | websocket.ts:78 | ✅ |
| `simulation_snapshot_created` | api.md:226 | websocket.ts:74 | ✅ |
| `e2e_run_started` | api.md:227 | websocket.ts:98 | ✅ |
| `e2e_run_finished` | api.md:228 | websocket.ts:102 | ✅ |
| `e2e_position` | api.md:229 | websocket.ts:86 | ✅ |
| `e2e_position_update` | api.md:230 | websocket.ts:90 | ✅ |
| `e2e_log` | api.md:231 | websocket.ts:94 | ✅ |

### 2.18 Rooms Socket.IO — ✅ Aligné

| Room | Doc | Code | Statut |
|---|---|---|---|
| `positions` | api.md:208 | websocket.ts:26 | ✅ |
| `executions` | api.md:208 | websocket.ts:27 | ✅ |
| `alerts` | api.md:208 | websocket.ts:28 | ✅ |
| `markets` | api.md:208 | websocket.ts:29 | ✅ |
| `e2e-runs` | api.md:208 | websocket.ts:30 | ✅ |

---

## 3. Code→Doc (Étape 3) — Routes réelles → documentées

### 3.1 Routes réelles NON documentées dans `docs/api.md`

| # | Route | Fichier:Ligne | Gravité |
|---|---|---|---|
| 1 | `GET /api/watchlist/settings` | watchlist.ts:50 | ⚠️ Mineure |
| 2 | `PUT /api/watchlist/settings` | watchlist.ts:55 | ⚠️ Mineure |
| 3 | `GET /api/copied-positions/:id/ticks` | positions.ts:98 | ⚠️ Mineure |
| 4 | `GET /api/markets/:conditionId/ticks` | markets.ts:113 | ⚠️ Mineure |
| 5 | `GET /api/e2e-runs/suites` | e2e-runs.ts:29 | ⚠️ Mineure |
| 6 | `GET /api/e2e-runs/suites/overview` | e2e-runs.ts:41 | ⚠️ Mineure |
| 7 | `GET /api/e2e-runs/active` | e2e-runs.ts:60 | ⚠️ Mineure |
| 8 | `GET /api/e2e-runs/:id/positions` | e2e-runs.ts:76 | ⚠️ Mineure |
| 9 | `GET /api/e2e-runs/:id/logs` | e2e-runs.ts:87 | ⚠️ Mineure |
| 10 | `POST /api/e2e-runs/:id/cancel` | e2e-runs.ts:136 | ⚠️ Mineure |
| 11 | `GET /api/simulation/analytics` | simulation.ts:49 | ⚠️ Mineure |
| 12 | `GET /api/simulation/analytics/trader-pnl-series` | simulation.ts:91 | ⚠️ Mineure |
| 13 | `GET /api/simulation/analytics/market` | simulation.ts:149 | ⚠️ Mineure |
| 14 | `GET /api/simulation/analytics/market-pnl-series` | simulation.ts:191 | ⚠️ Mineure |
| 15 | `GET /api/integration-settings/polygonscan/status` | config.ts:289 | ⚠️ Mineure |
| 16 | `PUT /api/integration-settings/polygonscan` | config.ts:297 | ⚠️ Mineure |
| 17 | `DELETE /api/integration-settings/polygonscan` | config.ts:325 | ⚠️ Mineure |

### 3.2 Divergences de documentation

| Route | Problème | Détail |
|---|---|---|
| `GET /api/market-tags` | Champ `cryptoTags` non documenté | api.md:48 dit `nav` + `tags` ; le code retourne aussi `cryptoTags` (market-tags.ts:42) |
| `GET /api/market-tags` | Query param `search` documenté | ✅ ok, mais le code supporte aussi un filtre à 50 résultats max (market-tags.ts:38-40) |
| `POST /api/algo-markets/notify-changed` | Auth documentée comme "sans JWT ni service token" | ✅ Confirmé : aucun middleware (algo-markets.ts:114) |

---

## 4. Vérifications Clés

### 4.1 Routes manquantes de l'audit précédent

| Route | Statut | Preuve |
|---|---|---|
| `GET /api/algo/market-chart/:conditionId` | ✅ **Présente et documentée** | Code: algo-market-chart.ts:28, Doc: api.md:163 |
| `POST /api/algo-markets/notify-changed` | ✅ **Présente et documentée** | Code: algo-markets.ts:114, Doc: api.md:164 |

### 4.2 Health check

| Critère | Statut | Preuve |
|---|---|---|
| `{ status, database, timestamp }` | ✅ | Doc api.md:201, Code index.ts:99-114 |
| HTTP 503 si PostgreSQL inaccessible | ✅ | Doc api.md:201, Code index.ts:108 |

### 4.3 Authentification JWT

| Critère | Statut | Preuve |
|---|---|---|
| Access token 15 min | ✅ | Doc 05-backend.md:14, jwt.ts |
| Refresh token 7 jours | ✅ | Doc 05-backend.md:14, jwt.ts |
| Rotation single-use (jti Redis) | ✅ | Doc 05-backend.md:15, auth.ts:85-91 |
| `requireJwt` (Bearer) | ✅ | Doc 05-backend.md:16, auth.ts:9-25 |
| `requireServiceToken` (x-service-token) | ✅ | Doc 05-backend.md:16, auth.ts:27-38 |

### 4.4 Routes internes — liste complète

La doc api.md:170-195 liste 24 routes internes. **23/24 sont confirmées**. La route `PATCH /api/internal/executions/:orderSignalId` (api.md:185) est **absente du code**.

---

## 5. Anomalies Détectées

### 🔴 Critique (1) — ✅ Corrigé

| ID | Description | Fichier | Correction |
|----|-------------|---------|------------|
| **A-1** | `PATCH /api/internal/executions/:orderSignalId` documentée (api.md:185) mais **absente du code**. | `docs/api.md:185` → code introuvable | ✅ **Supprimée de la doc** (plan `.hermes/plans/2026-07-06_PLAN_CORRECTION_AUDIT_DOCS.md` — P0-1) |

### ⚠️ Mineures (18) — ✅ Corrigées

| ID | Description | Fichier | Correction |
|----|-------------|---------|------------|
| **A-2** | `GET /api/watchlist/settings` non documentée | watchlist.ts:50 | ✅ **Ajoutée** dans `docs/api.md` section Watchlist |
| **A-3** | `PUT /api/watchlist/settings` non documentée | watchlist.ts:55 | ✅ **Ajoutée** dans `docs/api.md` section Watchlist |
| **A-4** | `GET /api/copied-positions/:id/ticks` non documentée | positions.ts:98 | ✅ **Ajoutée** dans `docs/api.md` section Positions copiées |
| **A-5** | `GET /api/markets/:conditionId/ticks` non documentée | markets.ts:113 | ✅ **Ajoutée** dans `docs/api.md` section Marchés |
| **A-6** | `GET /api/e2e-runs/suites` non documentée | e2e-runs.ts:29 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-7** | `GET /api/e2e-runs/suites/overview` non documentée | e2e-runs.ts:41 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-8** | `GET /api/e2e-runs/active` non documentée | e2e-runs.ts:60 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-9** | `GET /api/e2e-runs/:id/positions` non documentée | e2e-runs.ts:76 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-10** | `GET /api/e2e-runs/:id/logs` non documentée | e2e-runs.ts:87 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-11** | `POST /api/e2e-runs/:id/cancel` non documentée | e2e-runs.ts:136 | ✅ **Ajoutée** dans `docs/api.md` section Runs E2E |
| **A-12** | `GET /api/simulation/analytics` non documentée | simulation.ts:49 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-13** | `GET /api/simulation/analytics/trader-pnl-series` non documentée | simulation.ts:91 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-14** | `GET /api/simulation/analytics/market` non documentée | simulation.ts:149 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-15** | `GET /api/simulation/analytics/market-pnl-series` non documentée | simulation.ts:191 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-16** | `GET /api/integration-settings/polygonscan/status` non documentée | config.ts:289 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-17** | `PUT /api/integration-settings/polygonscan` non documentée | config.ts:297 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-18** | `DELETE /api/integration-settings/polygonscan` non documentée | config.ts:325 | ✅ **Ajoutée** dans `docs/api.md` section Configuration |
| **A-19** | `GET /api/market-tags` retourne aussi `cryptoTags` non documenté | market-tags.ts:42 | ✅ **Ajouté** dans `docs/api.md` section Configuration |

---

## 6. Corrections appliquées

Toutes les anomalies ont été corrigées via le plan [`.hermes/plans/2026-07-06_PLAN_CORRECTION_AUDIT_DOCS.md`](../.hermes/plans/2026-07-06_PLAN_CORRECTION_AUDIT_DOCS.md) (lots P0-P1).

**Build :** `npm run build` → 5/5 packages OK
**Tests :** `npm run test` → 100% passed
