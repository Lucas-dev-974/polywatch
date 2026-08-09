# Documentation Polywatch

**Polywatch** est une plateforme de *copy-trading* pour [Polymarket](https://polymarket.com).
Elle surveille en continu les positions de traders ciblés, détecte leurs
mouvements (ouverture, augmentation, réduction, clôture) et réplique
automatiquement ces mouvements — en mode **simulation** (paper trading) ou en
mode **réel** (placement d'ordres sur le CLOB Polymarket) — tout en appliquant
une couche de gestion du risque (SL / TP / trailing stop, sortie pré-clôture,
kill switch, limites d'exposition).

## Sommaire de la documentation

| Document | Contenu |
|----------|---------|
| [`architecture.md`](./architecture.md) | Vue d'ensemble, monorepo, processus, flux de données |
| [`pipeline-copy-trading.md`](./pipeline-copy-trading.md) | Pipeline détaillé : détection → copie → exécution → stratégie |
| [`modele-donnees.md`](./modele-donnees.md) | Entités, base PostgreSQL, files Redis |
| [`api.md`](./api.md) | Référence des routes REST et des évènements WebSocket |
| [`configuration.md`](./configuration.md) | Variables d'environnement, configuration du risque, démarrage |
| [`deployment.md`](./deployment.md) | Déploiement production, Docker, TLS, dry-run, activation trading réel |
| [`metrics.md`](./metrics.md) | Métriques Prometheus, alerting suggéré |
| [`metriques-marche.md`](./metriques-marche.md) | Métriques de marché : inventaire Polywatch vs CLOB/APIs, lacunes, pistes d'enrichissement |
| [`snapshots-simulation.md`](./snapshots-simulation.md) | Snapshots d'état simulation (archive, comparaison, auto-snapshot) |
| [`rapports-analyse.md`](./rapports-analyse.md) | Hub Rapports (Crypto Algo sim, comparaison, fingerprint, révisions config) |
| [`frontend.md`](./frontend.md) | Application SolidJS (pages, composants, temps réel) |
| [`crypto-algo.md`](./crypto-algo.md) | Module d'automatisation et de trading algorithmique (Auto-Track, stratégies) |
| [`weather-algo.md`](./weather-algo.md) | Module weather-algo (température, Open-Meteo, entrées/sorties, auto-track) |
| [`backtest.md`](./backtest.md) | Moteur de backtest événementiel (domaine weather : runs, modes, fidélité, API, UI) |
| [`code/`](./code/README.md) | Documentation détaillée du code — architecture, pipeline, packages (core, copy-trading, worker, backend, frontend, crypto-algo, weather-algo) |

> Les rapports d'audits et plans d'optimisation sont disponibles dans le dossier [`audits/`](./audits/).
>
> Optimisations latence/pipelines (phases 0–6, 2026-06-20) :
> [plan](./audits/2026-06-20_plan-optimisation-latence-pipelines.md) ·
> [implémentation](./audits/2026-06-20_implementation-optimisations-phases-0-6.md).
>
> Correction bugs pipelines position (phases 1–3, 2026-06-21) :
> [`audits/2026-06-21_correction-bugs-pipelines-position.md`](./audits/2026-06-21_correction-bugs-pipelines-position.md)
>
> Correctifs audit pipelines P0 (2026-07-05) :
> [`audits/2026-07-05_correction-pipelines-audit-p0.md`](./audits/2026-07-05_correction-pipelines-audit-p0.md)
>
> Audit file worker / positions algo pending (2026-07-12) :
> [`audits/2026-07-12_audit-crypto-algo-file-worker-pending-execution.md`](./audits/2026-07-12_audit-crypto-algo-file-worker-pending-execution.md)
>
> Patch pending + placing orphelin algo sim (2026-07-12) :
> [`patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md`](./patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md)
>
> Plan durcissement exécution crypto-algo (2026-07-12) :
> [`plans/applied/2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md`](./plans/applied/2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md)
>
> Correctifs rédemption réelle — collatéral dynamique (2026-07-12) :
> [`patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md`](./patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md) ·
> [`plans/applied/2026-07-12_PLAN_REDEMPTION_PHASE2.md`](./plans/applied/2026-07-12_PLAN_REDEMPTION_PHASE2.md)
>
> Résilience unhandled promise rejections & durcissement reset simulation (2026-07-17) :
> [`patchs/2026-07-17_PATCH_RESILIENCE_UNHANDLED_REJECTIONS.md`](./patchs/2026-07-17_PATCH_RESILIENCE_UNHANDLED_REJECTIONS.md)
>
> Ops — recovery rédemption stranded :
> [`../tools/recover-stranded-redemption/README.md`](../tools/recover-stranded-redemption/README.md)
>
> Audit global codebase / doc / bugs fantômes (2026-08-06) — **terminé 2026-08-07** (phases 1–5 + ops/produit) :
> [`plans/applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md`](./plans/applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md) ·
> [`plans/reference/2026-08-06_ANNEXE-risques-mitigations.md`](./plans/reference/2026-08-06_ANNEXE-risques-mitigations.md)
>
> Purge RiskConfig / P0 (2026-08-06) — **appliqué** (Phase F) ; C9 fallbacks purgés post-P0 (`6d99017`) :
> [`plans/applied/2026-08-06_PLAN-p0-implementation.md`](./plans/applied/2026-08-06_PLAN-p0-implementation.md) ·
> [`plans/reference/riskconfig-consumer-matrix.md`](./plans/reference/riskconfig-consumer-matrix.md)
>
> Audit weather-algo + correctifs (2026-08-04) — **appliqué** :
> [`audit-weather-algo-2026-08-04.md`](./audit-weather-algo-2026-08-04.md) ·
> [`code/08-weather-algo.md`](./code/08-weather-algo.md)
>
> Persistance données weather + onglet Données (2026-08-08) — **appliqué** (Phases 0–4) :
> [`plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md`](./plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md) ·
> [`plans/2026-08-08_PLAN-weather-market-data-persistence.md`](./plans/2026-08-08_PLAN-weather-market-data-persistence.md)
>
> Backtest événementiel weather (moteur `@polywatch/backtest` + onglet Backtest) — **appliqué** :
> [`backtest.md`](./backtest.md)
>
> Moteur de backtest événementiel (domaine weather) + onglet Backtest (2026-08-08) — **appliqué** :
> [`backtest.md`](./backtest.md) ·
> [`plans/2026-08-05_PLAN-backtest-engine-universel.md`](./plans/2026-08-05_PLAN-backtest-engine-universel.md)
>
> Sim-reset Redis hygiene (2026-07-12 + fixes 4.5) — **appliqué** (abort worker in-flight inclus, 2026-08-07) :
> [`plans/applied/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md`](./plans/applied/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md)
>
> Inventaire plans (actifs / applied / reference / archived) :
> [`plans/INDEX.md`](./plans/INDEX.md)
>
> Post-entry-mid logger (C10) — **appliqué** : migration `0095` / plan global §3.8
>
> Audits crypto août (diagnostic) :
> [`audits/2026-08-04_audit-crypto-algo-code-et-positions.md`](./audits/2026-08-04_audit-crypto-algo-code-et-positions.md) ·
> [`audits/2026-08-05_audit-naive-momentum-config.md`](./audits/2026-08-05_audit-naive-momentum-config.md) ·
> [`plans/2026-08-05_PLAN-strategies-crypto-algo-5min.md`](./plans/2026-08-05_PLAN-strategies-crypto-algo-5min.md)

## Vue d'ensemble rapide

```
┌─────────────┐   REST/WS   ┌─────────────┐
│  Frontend   │ ──────────► │   Backend   │
│  (SolidJS)  │ ◄────────── │  (Express)  │
└─────────────┘             └──────┬──────┘
                                   │ PostgreSQL + Redis
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │ copy-trading   │  │    worker      │  │  crypto-algo   │
     │ poll → COPY_*  │─►│ exécution+SL   │◄─│ ALGO_* signals │
     └────────────────┘  └────────────────┘  └────────────────┘
```

- **`@polywatch/core`** — logique métier partagée (entités TypeORM, services,
  pricing/VWAP, sizing, politique de risque, comptabilité de simulation).
- **`@polywatch/backend`** — API REST (Express), authentification JWT, serveur
  WebSocket (Socket.IO), intégration portefeuille/dépôt/retrait Polymarket.
- **`@polywatch/copy-trading`** — détection copy : polling traders, MoveDetector,
  pipelines entry/exit, enqueue `COPY_*` sur `order-signals`.
- **`@polywatch/worker`** — exécution CLOB/sim, sorties SL/TP/pre-close/kill-switch,
  rédemption, janitors (consomme `order-signals` / `algo-order-signals` /
  `close-signals`).
- **`@polywatch/crypto-algo`** — trading algorithmique autonome sur les marchés
  crypto court-terme (stratégies momentum, auto-track, surveillance OHLC).
- **`@polywatch/frontend`** — interface SolidJS (dashboards Simulation / Réel,
  leaderboard, portefeuille, marchés, trader insight, crypto-algo).

## Stack technique

| Domaine | Technologie |
|---------|-------------|
| Langage | TypeScript (ESM, `"type": "module"`) |
| Runtime | Node.js (≥ 22) |
| Base de données | PostgreSQL via TypeORM (`pg` driver, migrations) |
| Files / pub-sub | Redis (`ioredis`) |
| API HTTP | Express 5 |
| Temps réel | Socket.IO |
| Frontend | SolidJS + Vite |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Blockchain | `ethers` v6, SDK Polymarket (`clob-client`, `builder-*`) |
| Observabilité | `pino` (logs), `prom-client` (métriques) |
| Tests | Vitest (unitaires), Playwright (e2e) |

## Démarrage rapide

```bash
# 1. Installer les dépendances (workspaces npm)
npm install

# 2. Configurer l'environnement
cp .env.example .env   # puis éditer les secrets

# 3. Lancer Redis (requis par le worker)
#    ex: docker run -p 6379:6379 redis

# 4. Démarrer tous les services en développement
npm run dev
```

Le script `dev` orchestre les 7 packages via `concurrently` (core, backend,
worker, copy-trading, crypto-algo, weather-algo, frontend). Le worker, crypto-algo,
weather-algo et frontend attendent que le backend réponde sur
`http://127.0.0.1:3000/health` avant de démarrer.

> Voir [`configuration.md`](./configuration.md) pour le détail des variables
> d'environnement et des scripts disponibles.
