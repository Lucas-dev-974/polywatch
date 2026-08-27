# Polywatch

Plateforme de copy trading sur Polymarket — MVP mono-utilisateur, dual-mode simulation/réel.

## Structure

```
packages/
  core/          — @polywatch/core (entités, services, VWAP, idempotence)
  backend/       — @polywatch/backend (API Express + Socket.IO + auth JWT)
  copy-trading/  — @polywatch/copy-trading (détection copy : polling traders, pipelines entry/exit)
  worker/        — @polywatch/worker (exécution CLOB/sim, SL/TP, sorties risque, janitors)
  crypto-algo/   — @polywatch/crypto-algo (trading algorithmique crypto court-terme)
  weather-algo/  — @polywatch/weather-algo (trading algorithmique météo, Open-Meteo)
  backtest/      — @polywatch/backtest (moteur de backtest événementiel — replay weather)
  frontend/      — @polywatch/frontend (UI SolidJS)
```

## Démarrage local

```bash
cp .env.example .env
npm run generate-secrets   # coller les valeurs dans .env avant prod / trading réel
npm install
npm run migrate
# Redis requis (docker) :
docker compose up redis -d
# Option A — lancer tout en parallèle :
npm run dev
# Option B — par terminal :
npm run dev -w @polywatch/backend
npm run dev -w @polywatch/worker
npm run dev -w @polywatch/copy-trading
npm run dev -w @polywatch/crypto-algo
npm run dev -w @polywatch/weather-algo
npm run dev -w @polywatch/frontend
```
- Frontend : http://localhost:5173
- Backend : http://localhost:3000
- Login par défaut : `admin` / `changeme`

## Docker

```bash
docker compose up --build
```

## Tests

```bash
npm test                    # Vitest (core, backtest, worker, copy-trading, backend, frontend, crypto-algo, weather-algo)
npm run test:e2e            # Playwright
npm run spike:salt          # Gate ADR-031 (avant trading réel)
npm run dry-run:real        # Vérifications pré-trading réel
```

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Index documentation |
| [docs/reference/architecture.md](docs/reference/architecture.md) | Architecture technique |
| [docs/reference/deployment.md](docs/reference/deployment.md) | **Déploiement production & pré-trading** |
| [docs/reference/api.md](docs/reference/api.md) | Référence API REST & WebSocket |
| [docs/reference/configuration.md](docs/reference/configuration.md) | Configuration & exploitation |
| [docs/reference/frontend.md](docs/reference/frontend.md) | Application frontend SolidJS |
| [docs/reference/modele-donnees.md](docs/reference/modele-donnees.md) | Entités & modèle de données |
| [docs/reference/pipeline-copy-trading.md](docs/reference/pipeline-copy-trading.md) | Pipeline copy-trading détaillé |
| [docs/reference/metrics.md](docs/reference/metrics.md) | Métriques Prometheus |
| [docs/reference/snapshots-simulation.md](docs/reference/snapshots-simulation.md) | Snapshots simulation |
| [docs/reference/snapshots-real.md](docs/reference/snapshots-real.md) | Snapshots trading réel |
| [docs/reference/crypto-algo.md](docs/reference/crypto-algo.md) | Trading algorithmique (Auto-Track, stratégies) |
| [docs/reference/weather-algo.md](docs/reference/weather-algo.md) | Trading algorithmique météo |
| [docs/reference/backtest.md](docs/reference/backtest.md) | Moteur de backtest événementiel (weather) |
| [docs/code/](docs/code/README.md) | Documentation détaillée du code par package |
