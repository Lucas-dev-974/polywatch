# Documentation du code — Polywatch v0.1.0

Documentation technique du code (dernière mise à jour : séparation copy-trading / worker 2026-07-22).

## Sommaire

| Document | Contenu |
|---|---|
| [01-architecture.md](01-architecture.md) | Vue d'ensemble : monorepo, topologie runtime, flux de données, infrastructure |
| [02-pipeline-copy-trading.md](02-pipeline-copy-trading.md) | Le pipeline complet : détection → copie → exécution → finalisation → résolution |
| [03-core.md](03-core.md) | Package `@polywatch/core` : entités, services, VWAP, idempotence, risque, simulation |
| [04-worker.md](04-worker.md) | Package `@polywatch/worker` : exécution CLOB, sorties SL/TP, WebSockets, watchdogs |
| [05-copy-trading.md](05-copy-trading.md) | Package `@polywatch/copy-trading` : détection moves, pipelines entry/exit copy |
| [05-backend.md](05-backend.md) | Package `@polywatch/backend` : API REST, Socket.IO, crypto, flux dépôt/retrait |
| [06-frontend.md](06-frontend.md) | Package `@polywatch/frontend` : SolidJS, composants, hooks, flux utilisateur |
| [07-crypto-algo.md](07-crypto-algo.md) | Package `@polywatch/crypto-algo` : auto-track, stratégies ML, publication temps réel |
| [`../weather-algo.md`](../weather-algo.md) | Package `@polywatch/weather-algo` : marchés température, Open-Meteo, entrées/sorties, auto-track |

## Rappel du produit

Polywatch est une plateforme de **copy trading sur Polymarket**, mono-utilisateur (MVP), à double mode :

- **Simulation (`sim`)** : fills simulés sur le carnet d'ordres réel (VWAP), comptabilité cash pUSD virtuelle.
- **Réel (`real`)** : ordres FAK (Fill-and-Kill) passés sur le CLOB Polymarket via un deposit wallet (signature POLY_1271).

L'utilisateur suit jusqu'à 20 traders (watchlist). Quand un trader suivi ouvre/augmente/réduit/ferme une position, `@polywatch/copy-trading` détecte le mouvement et enqueue un signal ; `@polywatch/worker` exécute l'ordre et gère les sorties risque (SL/TP/trailing, plafonds d'exposition, kill switch journalier, sortie pre-close).

## Audits et plans associés

Les rapports d'audits et plans d'optimisation se trouvent dans le dossier [`audits/`](../audits/).

Correctifs pipelines position (2026-06-21) :
[`audits/2026-06-21_correction-bugs-pipelines-position.md`](../audits/2026-06-21_correction-bugs-pipelines-position.md)

Correctifs audit pipelines P0 (2026-07-05) :
[`audits/2026-07-05_correction-pipelines-audit-p0.md`](../audits/2026-07-05_correction-pipelines-audit-p0.md)

Correctifs rédemption réelle (2026-07-12) :
[`patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md`](../patchs/2026-07-12_PATCH_REDEMPTION_REELLE_COLLATERAL.md)

Résilience unhandled promise rejections & durcissement reset simulation (2026-07-17) :
[`patchs/2026-07-17_PATCH_RESILIENCE_UNHANDLED_REJECTIONS.md`](../patchs/2026-07-17_PATCH_RESILIENCE_UNHANDLED_REJECTIONS.md)
