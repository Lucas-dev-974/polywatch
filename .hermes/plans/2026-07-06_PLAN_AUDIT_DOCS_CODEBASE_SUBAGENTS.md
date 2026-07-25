# Plan d'Audit Doc ↔ Codebase — Polywatch v1.1 (Second Pass)

> **Pour Hermes :** Utiliser `delegate_task` pour dispatcher les subagents en parallèle, puis synthétiser les résultats.

**Objectif :** Vérifier que l'ensemble de la documentation technique (`docs/`) est alignée avec le code source après les corrections du 5 juillet 2026, et détecter toute nouvelle divergence.

**Contexte :** Un premier audit (2026-07-05) a identifié ~30 écarts et appliqué des corrections sur 10 fichiers docs. Ce second pass doit :
1. **Confirmer** que les corrections tiennent (vérification régressive)
2. **Détecter** les écarts résiduels (ce que le premier pass a manqué)
3. **Couvrir** les docs non auditées en détail (frontend, deployment, snapshots, configuration)

**Méthodologie :** Chaque subagent applique le protocole `.cursor/skills/audit-codebase-docs/SKILL.md` (4 étapes : Setup → Doc→Code → Code→Doc → Synthèse) sur son périmètre.

---

## Architecture de l'audit

```
                    ┌──────────────────────────────────────┐
                    │        Agent Coordinateur             │
                    │  (ce plan + synthèse finale)          │
                    └──┬───┬───┬───┬───┬───┬───┬───┬───────┘
                       │   │   │   │   │   │   │   │
        ┌──────────────┘   │   │   │   │   │   │   └──────────────┐
        ▼                  ▼   ▼   ▼   ▼   ▼   ▼                  ▼
   ┌─────────┐  ┌─────────┐  ┌───┐ ┌───┐ ┌───┐ ┌───┐  ┌─────────┐
   │Agent A  │  │Agent B  │  │ C │ │ D │ │ E │ │ F │  │Agent G  │
   │Architec.│  │Pipeline │  │Don-│ │Wor│ │API │ │Cry│  │Metrics  │
   │+ Infra  │  │Copy-Trad│  │nées│ │ker │ │+   │ │pto│  │+ Config │
   └─────────┘  └─────────┘  └───┘ └───┘ └───┘ └───┘  └─────────┘
                                                          ┌─────────┐
                                                          │Agent H  │
                                                          │Frontend │
                                                          │+ Deploy │
                                                          └─────────┘
```

---

## Subagent A — Architecture & Infrastructure

**Périmètre doc :**
- `docs/architecture.md` (161 lignes)
- `docs/code/01-architecture.md` (76 lignes)
- `docs/README.md` (102 lignes — sommaire général)

**Périmètre code :**
- `packages/backend/src/index.ts` (routes montées, middlewares)
- `packages/worker/src/index.ts` (boucles, connexions)
- `packages/crypto-algo/src/index.ts` (boucles, connexions)
- `docker-compose.yml`
- `package.json` (workspaces, scripts)

**Vérifications clés :**
1. ✅ Routes montées dans `architecture.md` (lignes 44-67) → comparer avec `backend/src/index.ts` (grep `app.use`)
2. ✅ Canal Redis `backend-ready` mentionné dans le tableau "Communication inter-services" ?
3. ✅ Cadence `MarketResolutionWatcher` : doc dit 15 s → vérifier `worker/src/constants.ts` + call site `index.ts`
4. ✅ 5 processus décrits → toujours 5 ? (vérifier `docker-compose.yml` services)
5. ✅ `docs/README.md` sommaire liste-t-il tous les fichiers `docs/*.md` ? (grep `find docs -maxdepth 1 -name '*.md'`)
6. ✅ Doublons dans le sommaire ?
7. ✅ Ports, CORS, rate-limit décrits correctement

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent B — Pipeline Copy-Trading

**Périmètre doc :**
- `docs/pipeline-copy-trading.md` (425 lignes)
- `docs/code/02-pipeline-copy-trading.md` (190 lignes)

**Périmètre code :**
- `packages/worker/src/processors/move-detector.ts`
- `packages/worker/src/processors/copy/copy-processor.ts`
- `packages/worker/src/processors/copy/copy-entry-pipeline.ts`
- `packages/worker/src/processors/copy/copy-exit-pipeline.ts`
- `packages/worker/src/processors/copy/copy-risk-gate.ts`
- `packages/worker/src/processors/strategy/strategy-processing.ts`
- `packages/worker/src/processors/strategy/position-exit-evaluator.ts`
- `packages/worker/src/constants.ts`
- `packages/core/src/risk/policy.ts`
- `packages/core/src/risk/exit-decision.ts`

**Vérifications clés :**
1. ✅ Cadences documentées vs code : move-detector (2s), strategy (100ms), market-resolution (15s), redemption (15s)
2. ✅ Refactor `copy/` : les chemins `copy-processor.ts` sont-ils mis à jour ou encore l'ancien monolithe ?
3. ✅ `TIME_EXIT` (hard exit) documenté dans les deux docs ?
4. ✅ `lastTradePrice` pour sorties forcées illiquides — mentionné correctement ?
5. ✅ Statuts position : `pending → open → closing → closed` (+ `failed`, `pending_resolution`, `cancelled`) — complets ?
6. ✅ Files Redis : `move-events`, `order-signals`, `close-signals`, `execution-results` — noms exacts ?
7. ✅ Gate MOS sur `DECREASED` partiel documenté ?
8. ✅ Triple-pass VWAP, filtre bid/ask, réservation transactionnelle — décrits correctement ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent C — Modèle de Données & Core

**Périmètre doc :**
- `docs/modele-donnees.md` (225 lignes)
- `docs/code/03-core.md` (168 lignes)

**Périmètre code :**
- `packages/core/src/entities/` (tous les fichiers)
- `packages/core/src/migrations/` (tous les fichiers)
- `packages/core/src/services/` (18 services)
- `packages/core/src/risk/`
- `packages/core/src/database/data-source.ts`

**Vérifications clés :**
1. ✅ **Comptage entités** : doc dit 22 → `ls packages/core/src/entities/*.ts | grep -v index | grep -v test | wc -l`
2. ✅ **Comptage migrations** : doc dit 24 → `ls packages/core/src/migrations/*.ts | wc -l`
3. ✅ `AlgoPriceTick` présent dans les deux docs ?
4. ✅ `synchronize: true` — la doc dit-elle correctement que c'est désactivé en production ?
5. ✅ Tous les champs `RiskConfig` documentés correspondent-ils à l'entité ?
6. ✅ 18 services listés dans `03-core.md` → `ls packages/core/src/services/*.ts | wc -l`
7. ✅ Nouvelles entités depuis le dernier audit (E2e*, MarketPositionTick, IntegrationSettings) — documentées ?
8. ✅ Relations conceptuelles (diagramme `modele-donnees.md`) — toujours exactes ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent D — Worker

**Périmètre doc :**
- `docs/code/04-worker.md` (117 lignes)

**Périmètre code :**
- `packages/worker/src/index.ts` (bootstrap complet)
- `packages/worker/src/processors/` (tous les sous-dossiers)
- `packages/worker/src/clob/`
- `packages/worker/src/polymarket/`
- `packages/worker/src/constants.ts`

**Vérifications clés :**
1. ✅ Composants listés dans `04-worker.md` (MarketPercentPublisher, OpenPositionTracker, MarketTickRecorder, etc.) — existent-ils toujours ?
2. ✅ Composants manquants détectés par l'audit précédent — ont-ils été ajoutés à la doc ?
3. ✅ Boucles et watchdogs : toutes les boucles de `index.ts` sont-elles documentées ?
4. ✅ Connexions Redis : 7+ décrites → vérifier le nombre réel dans `index.ts`
5. ✅ Module CLOB : `real-executor.ts`, `execution-reconciler.ts`, `min-order-size.ts`, `position-lock-registry.ts` — documentés ?
6. ✅ WebSockets Polymarket : `websocket-book.ts`, `websocket-user.ts` — documentés ?
7. ✅ `backend-readiness.ts` — documenté ?
8. ✅ Purge horaire `MarketPositionTick` — documentée ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent E — API REST & WebSocket

**Périmètre doc :**
- `docs/api.md` (231 lignes)
- `docs/code/05-backend.md` (99 lignes)

**Périmètre code :**
- `packages/backend/src/index.ts` (routes montées)
- `packages/backend/src/routes/` (tous les fichiers)
- `packages/backend/src/websocket.ts`
- `packages/backend/src/middleware/auth.ts`

**Vérifications clés :**
1. ✅ **Routes documentées vs routes réelles** : `grep "app.use" backend/src/index.ts` → comparer chaque route avec `docs/api.md`
2. ✅ Routes manquantes de l'audit précédent : `GET /api/algo/market-chart/:conditionId`, `POST /api/algo-markets/notify-changed` — ajoutées ?
3. ✅ Événements WebSocket : `market_tick`, `market_pct_update`, `algo_markets_changed`, `e2e_run_*` — documentés ?
4. ✅ Rooms Socket.IO : `positions`, `executions`, `alerts` + `markets`, `e2e-runs` — documentées ?
5. ✅ Health check : `{ status, database, timestamp }` — doc alignée ?
6. ✅ Routes internes (`/api/internal`) — liste complète ?
7. ✅ Auth : JWT 15 min, refresh 7j, rotation single-use — documenté ?
8. ✅ `requireServiceToken` — documenté pour les bonnes routes ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent F — Crypto-Algo

**Périmètre doc :**
- `docs/crypto-algo.md` (133 lignes)
- `docs/code/07-crypto-algo.md` (219 lignes)

**Périmètre code :**
- `packages/crypto-algo/src/index.ts`
- `packages/crypto-algo/src/strategy/`
- `packages/crypto-algo/src/processors/`
- `packages/core/src/entities/AlgoPriceTick.ts`
- `packages/backend/src/routes/algo-market-chart.ts`
- `packages/backend/src/routes/algo-markets.ts`

**Vérifications clés :**
1. ✅ Hard exit / `TIME_EXIT` — documenté dans les deux docs ?
2. ✅ `PriceTickRecorder` + `AlgoPriceTick` — documentés ?
3. ✅ `GET /api/algo/market-chart/:conditionId` — documenté dans `api.md` et `crypto-algo.md` ?
4. ✅ `POST /api/algo-markets/notify-changed` — documenté (et note de sécurité) ?
5. ✅ `cryptoAlgoMaxPositionSizeUsdc` — supprimé de la doc (paramètre fantôme) ?
6. ✅ `SignalStateRegistry`, `PositionContextCache` — documentés dans `07-crypto-algo.md` ?
7. ✅ Boucles et cadences : `StrategyRunner` (30s), `PriceTickRecorder` (1s), heartbeat (30s) — exactes ?
8. ✅ `cryptoAlgoSlBidPoints` / `cryptoAlgoTpBidPoints` — documentés correctement ?
9. ✅ 3 connexions Redis dédiées — documentées ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent G — Métriques Prometheus & Configuration

**Périmètre doc :**
- `docs/metrics.md` (178 lignes)
- `docs/configuration.md` (220 lignes)
- `docs/plans/2026-07-05_PLAN_P0_METRIQUES.md` (598 lignes — vérifier cohérence)
- `.env.example`

**Périmètre code :**
- `packages/backend/src/metrics.ts`
- `packages/backend/src/index.ts` (exposition `/metrics`)
- `packages/worker/src/processors/move-detector.ts` (push circuit-breaker)
- `packages/core/src/config/env.ts`

**Vérifications clés :**
1. ✅ **Comptage métriques** : `grep -c "name:" packages/backend/src/metrics.ts` vs nombre dans `docs/metrics.md`
2. ✅ Statut par métrique (Actif/Partiel/Déclaré) — toujours exact après corrections ?
3. ✅ Labels exacts (code) vs labels documentés — alignés ?
4. ✅ Exemples PromQL opérationnels — testables ?
5. ✅ Alerting — seuls les alertes "Oui" sont vraiment opérationnels ?
6. ✅ **Variables d'environnement** : toutes les vars de `configuration.md` sont-elles dans `.env.example` ?
7. ✅ Vars manquantes dans `.env.example` détectées par l'audit précédent — ajoutées ?
8. ✅ `CRYPTO_ALGO_POLL_MS` documenté avec sa valeur par défaut (30000) ?
9. ✅ `CORS_ORIGIN` documenté avec sa valeur par défaut ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Subagent H — Frontend, Déploiement & Snapshots

**Périmètre doc :**
- `docs/frontend.md` (178 lignes)
- `docs/code/06-frontend.md` (101 lignes)
- `docs/deployment.md` (227 lignes)
- `docs/snapshots-simulation.md` (170 lignes)

**Périmètre code :**
- `packages/frontend/src/App.tsx`
- `packages/frontend/src/lib/ui-persistence.ts`
- `packages/frontend/src/pages/`
- `packages/core/src/services/simulation-archive.service.ts`
- `docker-compose.yml`
- `packages/backend/src/index.ts` (auto-snapshot loop)

**Vérifications clés :**
1. ✅ **Pages frontend** : doc dit 6 pages (`APP_PAGES`) → vérifier `ui-persistence.ts` — toujours 6 ? (l'audit précédent dit 7 avec `e2e-tests`)
2. ✅ `e2e-tests` page — documentée dans `frontend.md` et `06-frontend.md` ?
3. ✅ Trader Insight page — documentée ?
4. ✅ Snapshots simulation : déclencheurs (manual/auto/reset), labels, `skipIfEmpty` — exacts ?
5. ✅ Déploiement : Docker services, secrets, prérequis — toujours valides ?
6. ✅ `docker-compose.yml` services listés dans `deployment.md` ?
7. ✅ Port bindings documentés (3000, 5173, 5432, 6379) — exacts ?
8. ✅ Scripts `package.json` — `generate-secrets`, `migrate`, `dev` — documentés ?

**Protocole :** `.cursor/skills/audit-codebase-docs/SKILL.md` — 4 étapes complètes.

---

## Synthèse Finale (Agent Coordinateur)

Après réception des 8 rapports de subagents :

1. **Compiler** une matrice de synthèse (document → alignement estimé → actions restantes)
2. **Identifier** les écarts transverses (ex: une route manquante signalée par Agent E ET Agent F)
3. **Prioriser** les corrections (P0 Critique / P1 Majeur / P2 Mineur)
4. **Produire** un rapport consolidé dans `docs/audits/2026-07-06_audit-documentation-second-pass.md`
5. **Appliquer** les corrections doc si demandé (fix-and-correct mode)

---

## Calendrier & Dépendances

| Étape | Durée estimée | Dépend de |
|-------|---------------|-----------|
| Dispatch 8 subagents (parallèle) | ~2-3 min | Rien |
| Chaque subagent | ~30-60 s | Rien (parallèle) |
| Synthèse coordinateur | ~2 min | Tous les subagents |
| Corrections doc (si demandé) | ~5-10 min | Rapport synthèse |

**Total estimé :** ~5-15 min selon le nombre de corrections.

---

## Fichiers de sortie

- `docs/audits/2026-07-06_audit-documentation-second-pass.md` — Rapport consolidé
- Corrections directes sur les fichiers `docs/*.md` si mode fix-and-correct

---

## Vérification finale

1. `npm run build` — tous les packages compilent
2. `npm run test` — tous les tests passent
3. Vérification manuelle : `grep` des compteurs (entités, migrations, routes, métriques) confirmés
