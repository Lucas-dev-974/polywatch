# Architecture générale

> Vue synthétique : monorepo, topologie runtime, communication inter-services, modes
> de trading. Pour le détail des processus applicatifs (démarrage, composants internes,
> files Redis, persistance, observabilité), voir [`../reference/architecture.md`](../reference/architecture.md).

## Monorepo

```
Polywatch-v1/
├── packages/
│   ├── core/       @polywatch/core      — domaine partagé : entités TypeORM, services, calculs (VWAP, fees, sizing, risk)
│   ├── backend/    @polywatch/backend   — API Express + Socket.IO, auth JWT, flux wallet (dépôt/retrait/bridge)
│   ├── worker/     @polywatch/worker    — exécution CLOB/sim, SL/TP, sorties risque, janitors
│   ├── copy-trading/ @polywatch/copy-trading — détection copy : polling traders, pipelines entry/exit
│   ├── crypto-algo/ @polywatch/crypto-algo — trading algorithmique crypto court-terme (auto-track, stratégies)
│   ├── weather-algo/ @polywatch/weather-algo — trading algorithmique météo (température, Open-Meteo)
│   ├── backtest/   @polywatch/backtest  — moteur événementiel (lib, consommée in-process par le backend)
│   └── frontend/   @polywatch/frontend  — UI SolidJS (Vite, port 5173)
├── scripts/        — generate-secrets, backup DB, spike salt CLOB, inspection wallet
├── e2e/            — test Playwright (login) + tests E2E crypto-algo
├── data/           — logs E2E (volume partagé)
├── docker-compose.yml
└── .env / .env.example
```

Workspaces npm. `core` est compilé (`dist/`) et consommé par `backend`, `worker`, `copy-trading`, `crypto-algo`, `weather-algo` et `backtest`. TypeScript ESM partout (`tsconfig.base.json`). Le backend dépend aussi de `@polywatch/backtest` (pas de process `dev` autonome).

## Topologie runtime

```
                    +---------------------------------------------+
                    |                  Frontend                   |
                    |       SolidJS (5173) — REST + Socket.IO     |
                    +--------------------+------------------------+
                                         | /api + /socket.io
                    +--------------------v------------------------+
                    |                  Backend                    |
                    |  Express (3000) + Socket.IO + JWT           |
                    |  Routes publiques (JWT) + /api/internal     |
                    +----------+------------------+---------------+
                               |                  |
                    PostgreSQL (TypeORM)     Redis pub/sub + listes
         +---------------------+------------------+----------------+
         |                     |                  |                |
  +------v------+   +----------v-------+  +-------v--------+  +----v-----+
  |copy-trading |   | crypto / weather |  |     worker     |  | postgres |
  | Data API    |   | algo (signaux)   |  | exécution CLOB |  +----------+
  | move-events |   | *order-signals   |  | SL/TP / close  |
  | order-signals|  +------------------+  | WS user CLOB   |
  +-------------+                         +----------------+
```

| Service | Rôle |
|---|---|
| **copy-trading** | Poll traders Polymarket, détecte les moves, pipelines copy → enqueue `order-signals` |
| **crypto-algo** | Signaux algo → enqueue `algo-order-signals` |
| **weather-algo** | Signaux météo city-first → `weather-order-signals` ; closes drift/bucket → `close-signals` |
| **worker** | Consomme `order-signals`, `algo-order-signals`, `weather-order-signals`, `close-signals` ; exécution + sorties risque |

## Composants d'infrastructure

| Composant | Détails |
|---|---|
| **PostgreSQL** | TypeORM, `pg` driver. Schéma créé par `npm run migrate` (`core/src/migrate.ts`, migrations + seed). Connection via `DATABASE_URL`. Timeouts : `statement_timeout=30s`, `lock_timeout=10s`. |
| **Redis** | Files de jobs : `move-events` (interne copy-trading), `order-signals`, `algo-order-signals`, `weather-order-signals`, `close-signals`, `execution-results`. Pattern `BRPOPLPUSH` vers clés `:processing`, dead-letter queues, canal pub/sub `config-changed`. |
| **Socket.IO** | Rooms `positions`, `executions`, `alerts`, `markets`, `e2e-runs`. Auth par access token JWT au handshake. |
| **Secrets** | `.env` : `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SERVICE_TOKEN`, `MASTER_ENCRYPTION_KEY` (AES-256-GCM des clés privées et credentials CLOB). `validateProductionSecrets` crash le process en production si valeurs par défaut. `canEnableRealTrading()` bloque le mode réel si secrets insécurisés. |

## Communication inter-services

- **Worker / copy-trading / crypto-algo / weather-algo → Backend** : HTTP `/api/internal/*` authentifié par `x-service-token` (credentials CLOB déchiffrés côté worker uniquement, réservations, claims, notifications WebSocket, balances, move-detected, rédemption on-chain).
- **Backend → services** : publication Redis `config-changed` (rechargement à chaud) ; `backend-ready` ; `simulation-reset` ; push direct sur `close-signals` pour les fermetures manuelles.
- **copy-trading → worker** : file Redis `order-signals` (`COPY_*`). File `move-events` **interne** à copy-trading uniquement.
- **crypto-algo → worker** : file Redis `algo-order-signals` (`ALGO_*`).
- **weather-algo → worker** : file Redis `weather-order-signals` (`WEATHER_OPEN`) et `close-signals` (`WEATHER_FORECAST_CHANGE`, `WEATHER_BUCKET_EXIT`).
- **worker (strategy) / weather-algo → worker (executor)** : file Redis `close-signals` (SL/TP/pre-close/kill-switch/weather).
- **Heartbeats** : clés Redis `worker:heartbeat`, `copy-trading:heartbeat`, `crypto-algo:heartbeat`, `weather-algo:heartbeat` (EX 60 s), lues par `/api/system/overview`.

## Modes de trading

| | Simulation (`sim`) | Réel (`real`) |
|---|---|---|
| Solde | `SimulationBalance` (pUSD virtuel, défaut 10 000) | Solde pUSD on-chain du deposit wallet (cache 10 s) |
| Fill | VWAP du carnet en mémoire + frais taker théoriques | Ordre FAK `createAndPostMarketOrder` sur le CLOB |
| Résultat | Immédiat (synchrone) | Parse de la réponse + canal WS user + réconciliation au démarrage et à chaque reconnexion WS |
| Rédemption | Crédit cash simulé (payoff 0/1) | `redeemPositions` on-chain via relayer (`POST /api/internal/redeem`, collatéral détecté via `assetId`, auto-wrap USDC.e→pUSD) |

Chaque entrée de watchlist a deux flags indépendants `simEnabled` / `realEnabled` ; les configs isolées (`CopyConfig` / `CryptoConfig` / `WeatherConfig` / `GlobalConfig`) portent les paramètres par mode (`*Sim` / `*Real` ou champs dédiés).
