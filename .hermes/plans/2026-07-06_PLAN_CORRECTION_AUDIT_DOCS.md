# Plan de Correction — Audit Documentation ↔ Codebase Polywatch v1.1

> **Date :** 2026-07-06
> **Source :** Audits subagents (A–H) — second pass après corrections du 2026-07-05
> **Mode :** Fix-and-correct — chaque tâche modifie directement les fichiers docs

---

## Résumé des audits reçus

| Subagent | Périmètre | Alignement | 🔴 Critique | 🟡 Majeure | 🟢 Mineure |
|----------|-----------|-----------|:-----------:|:----------:|:----------:|
| **B** | Pipeline Copy-Trading | ~97% | 0 | 4 | 11 |
| **D** | Worker | ≥90% | 0 | 2 | 13 |
| **E** | API REST & WebSocket | ~78% | 1 | 0 | 18 |
| **F** | Crypto-Algo | 100% | 0 | 0 | 2 |
| **A** | Architecture & Infra | ⏳ | — | — | — |
| **C** | Modèle de Données & Core | ⏳ | — | — | — |
| **G** | Métriques & Configuration | ⏳ | — | — | — |
| **H** | Frontend, Déploiement & Snapshots | ⏳ | — | — | — |

---

## Lot P0 — Corrections immédiates (🔴 Critique)

### P0-1 : Route fantôme `PATCH /api/internal/executions/:orderSignalId`

**Fichier :** `docs/api.md` ligne 185
**Problème :** Route documentée mais absente du code (ni dans `internal/positions-routes.ts` ni ailleurs)
**Action :** Supprimer la ligne de `docs/api.md`
**Preuve :** Audit E — anomalie A-1

---

## Lot P1 — Documentation des routes manquantes (API)

### P1-1 : Routes E2E (6 routes)

**Fichier :** `docs/api.md` — section "Runs E2E"
**Routes à ajouter :**
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/e2e-runs/suites` | Liste des suites de tests disponibles |
| GET | `/api/e2e-runs/suites/overview` | Vue d'ensemble des suites |
| GET | `/api/e2e-runs/active` | Run E2E actif (s'il y en a un) |
| GET | `/api/e2e-runs/:id/positions` | Positions d'un run E2E |
| GET | `/api/e2e-runs/:id/logs` | Logs d'un run E2E |
| POST | `/api/e2e-runs/:id/cancel` | Annulation d'un run E2E |

**Preuve :** Audit E — anomalies A-6 à A-11

### P1-2 : Routes analytics simulation (4 routes)

**Fichier :** `docs/api.md` — section "Configuration / Simulation / CLOB"
**Routes à ajouter :**
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/simulation/analytics` | Analytics simulation (agrégats) |
| GET | `/api/simulation/analytics/trader-pnl-series` | Série PnL par trader |
| GET | `/api/simulation/analytics/market` | Analytics par marché |
| GET | `/api/simulation/analytics/market-pnl-series` | Série PnL par marché |

**Preuve :** Audit E — anomalies A-12 à A-15

### P1-3 : Routes watchlist settings (2 routes)

**Fichier :** `docs/api.md` — section "Watchlist"
**Routes à ajouter :**
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/watchlist/settings` | Paramètres de la watchlist |
| PUT | `/api/watchlist/settings` | Met à jour les paramètres de la watchlist |

**Preuve :** Audit E — anomalies A-2, A-3

### P1-4 : Routes ticks (2 routes)

**Fichier :** `docs/api.md` — sections "Positions copiées" et "Marchés"
**Routes à ajouter :**
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/copied-positions/:id/ticks` | Ticks de marché pour une position copiée |
| GET | `/api/markets/:conditionId/ticks` | Ticks de marché pour un marché |

**Preuve :** Audit E — anomalies A-4, A-5

### P1-5 : Routes Polygonscan (3 routes)

**Fichier :** `docs/api.md` — section "Configuration / Simulation / CLOB"
**Routes à ajouter :**
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/integration-settings/polygonscan/status` | Statut de la clé API Polygonscan |
| PUT | `/api/integration-settings/polygonscan` | Enregistre la clé API Polygonscan |
| DELETE | `/api/integration-settings/polygonscan` | Supprime la clé API Polygonscan |

**Preuve :** Audit E — anomalies A-16 à A-18

### P1-6 : Champ `cryptoTags` sur `GET /api/market-tags`

**Fichier :** `docs/api.md` — section "Configuration / Simulation / CLOB"
**Problème :** La réponse documentée (`nav` + `tags`) omet `cryptoTags`
**Action :** Ajouter `cryptoTags` à la description de la réponse
**Preuve :** Audit E — anomalie A-19

---

## Lot P2 — Documentation Worker (lacunes majeures)

### P2-1 : Ajouter `connection-manager.ts` dans `04-worker.md`

**Fichier :** `docs/code/04-worker.md` — section "WebSockets Polymarket"
**Action :** Ajouter une mention du `ConnectionManager` comme hub central des connexions WS et carnets d'ordres
**Preuve :** Audit D — recommandation 🔴 haute #1

### P2-2 : Ajouter `sl-close-retry.ts` dans `04-worker.md`

**Fichier :** `docs/code/04-worker.md` — section "Module CLOB" ou nouvelle section "Exécution"
**Action :** Documenter la logique de retry des forced exits (SL, trailing, kill-switch)
**Preuve :** Audit D — recommandation 🔴 haute #2

### P2-3 : Ajouter section "Exécution" dans `04-worker.md`

**Fichier :** `docs/code/04-worker.md`
**Fichiers à documenter :**
- `execution-completion.ts` — Finalisation d'exécution
- `notify-execution.ts` — Notification backend (avec circuit breaker)
- `slippage-guard.ts` — Protection slippage
- `sl-close-retry.ts` — Retry forced exits

**Preuve :** Audit D — recommandations ⚠️ #3

### P2-4 : Ajouter `startup-reconciler.ts` dans la section Démarrage

**Fichier :** `docs/code/04-worker.md` — section "Démarrage"
**Action :** Ajouter `startup-reconciler.ts` (réconciliation des ordres CLOB au démarrage)
**Preuve :** Audit D — recommandation ⚠️ #4

### P2-5 : Ajouter `worker-context-refresh.ts` dans la section Abonnements Redis

**Fichier :** `docs/code/04-worker.md` — section "Démarrage" (abonnements Redis)
**Action :** Documenter le refresh partagé `config-changed` / `backend-ready`
**Preuve :** Audit D — recommandation ⚠️ #5

### P2-6 : Ajouter `market-tick-publisher.ts` et `position-evaluator.ts` dans la section Stratégie

**Fichier :** `docs/code/04-worker.md` — section "Module stratégie"
**Action :** Ajouter ces deux fichiers aux tables de la section stratégie
**Preuve :** Audit D — recommandation ⚠️ #6

### P2-7 : Ajouter `circuit-breaker.ts` comme mécanisme de résilience

**Fichier :** `docs/code/04-worker.md`
**Action :** Mentionner le circuit breaker générique comme mécanisme transverse
**Preuve :** Audit D — recommandation ⚠️ #7

---

## Lot P3 — Documentation Pipeline Copy-Trading (lacunes majeures)

### P3-1 : Ajouter le filtre momentum dans `02-pipeline-copy-trading.md`

**Fichier :** `docs/code/02-pipeline-copy-trading.md` — section "Décision de copie"
**Action :** Documenter le filtre momentum (`isEntryMomentumAcceptable`) qui vérifie la direction du mouvement avant d'entrer
**Preuve :** Audit B — lacune majeure #1

### P3-2 : Ajouter le signal score sizing dans `02-pipeline-copy-trading.md`

**Fichier :** `docs/code/02-pipeline-copy-trading.md` — section "Décision de copie"
**Action :** Documenter le sizing basé sur le signal score (confiance du signal → taille de la position)
**Preuve :** Audit B — lacune majeure #2

### P3-3 : Ajouter le filtre proximité SL dans `02-pipeline-copy-trading.md`

**Fichier :** `docs/code/02-pipeline-copy-trading.md` — section "Décision de copie"
**Action :** Documenter le filtre qui bloque une entrée si le SL est trop proche du prix d'entrée
**Preuve :** Audit B — lacune majeure #3

### P3-4 : Ajouter `minTimeToClose` dans `02-pipeline-copy-trading.md`

**Fichier :** `docs/code/02-pipeline-copy-trading.md` — section "Décision de copie"
**Action :** Documenter la garde `minTimeToClose` qui empêche les entrées trop proches de la clôture du marché
**Preuve :** Audit B — lacune majeure #4

### P3-5 : Corriger le chemin de `copy-processor.ts` dans `pipeline-copy-trading.md`

**Fichier :** `docs/pipeline-copy-trading.md`
**Problème :** Le tableau indique `copy-processor.ts` dans le dossier `copy/` alors qu'il est à la racine de `processors/`
**Action :** Corriger le chemin
**Preuve :** Audit B — divergence mineure

---

## Lot P4 — Documentation Crypto-Algo (mineures)

### P4-1 : Documenter la cadence de cleanup des ticks (1h)

**Fichier :** `docs/crypto-algo.md` §7 ou `docs/code/07-crypto-algo.md`
**Action :** Ajouter l'intervalle de cleanup (1h) — seule la purge 24h est documentée actuellement
**Preuve :** Audit F — recommandation mineure #1

### P4-2 : Documenter le refresh du PositionContextCache (5s)

**Fichier :** `docs/code/07-crypto-algo.md`
**Action :** Ajouter la cadence de refresh du cache (5s)
**Preuve :** Audit F — recommandation mineure #2

---

## Lot P5 — En attente des subagents restants

Les sous-sections suivantes seront complétées à réception des audits A, C, G et H :

- **P5-x** : Architecture & Infra (A) — corrections sommaire, routes, Redis, Docker
- **P5-y** : Modèle de Données (C) — comptages entités/migrations, AlgoPriceTick, synchronize
- **P5-z** : Métriques & Configuration (G) — .env.example, vars manquantes, statuts métriques
- **P5-w** : Frontend & Déploiement (H) — pages, Docker services, scripts

---

## Ordre d'exécution recommandé

```
Lot P0 (1 tâche)       → 🔴 Critique, 1 fichier
Lot P1 (6 tâches)      → 🟡 17 routes + 1 champ, 1 fichier (api.md)
Lot P2 (7 tâches)      → 🟡 1 fichier (04-worker.md)
Lot P3 (5 tâches)      → 🟡 2 fichiers (pipeline docs)
Lot P4 (2 tâches)      → 🟢 2 fichiers (crypto-algo docs)
Lot P5 (en attente)    → À compléter
```

**Estimation :** ~30-45 min de corrections, réparties sur 5 fichiers docs principaux.

---

## Vérification finale

Après toutes les corrections :
1. `grep` des compteurs (entités, migrations, routes, métriques) — confirmés
2. Vérification que les liens internes (`./audits/`, `./plans/`) sont valides
3. `npm run build` — tous les packages compilent
