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
npm run dev -w @polywatch/crypto-algo
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
npm test                    # Vitest (core + worker + backend + frontend + crypto-algo)
npm run test:e2e            # Playwright
npm run spike:salt          # Gate ADR-031 (avant trading réel)
npm run dry-run:real        # Vérifications pré-trading réel
```

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Index documentation |
| [docs/architecture.md](docs/architecture.md) | Architecture technique |
| [docs/deployment.md](docs/deployment.md) | **Déploiement production & pré-trading** |
| [docs/api.md](docs/api.md) | Référence API REST & WebSocket |
| [docs/configuration.md](docs/configuration.md) | Configuration & exploitation |
| [docs/frontend.md](docs/frontend.md) | Application frontend SolidJS |
| [docs/modele-donnees.md](docs/modele-donnees.md) | Entités & modèle de données |
| [docs/pipeline-copy-trading.md](docs/pipeline-copy-trading.md) | Pipeline copy-trading détaillé |
| [docs/metrics.md](docs/metrics.md) | Métriques Prometheus |
| [docs/snapshots-simulation.md](docs/snapshots-simulation.md) | Snapshots simulation |
| [docs/crypto-algo.md](docs/crypto-algo.md) | Trading algorithmique (Auto-Track, stratégies) |
| [docs/code/](docs/code/README.md) | Documentation détaillée du code par package |
