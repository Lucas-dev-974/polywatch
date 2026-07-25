# Audit : alignement documentation ↔ codebase

**Date :** 5 juillet 2026  
**Périmètre :** documentation `docs/` vs code source (`packages/*/src`)  
**Focus :** pipelines/processus, métriques Prometheus, API, modèle de données  
**Verdict :** documentation globalement utile mais **désalignée sur les métriques** (~75 % des compteurs documentés ne sont pas alimentés) et **incomplète** sur le worker récent et le module crypto-algo (hard exit, price ticks).

---

## 1. Résumé exécutif

| Domaine | Alignement estimé | Sévérité principale |
|---------|---------------------|---------------------|
| Architecture / monorepo | ~90 % | Faible |
| Pipeline copy-trading | ~85 % | Moyenne (cadences, refactor fichiers) |
| Worker (composants récents) | ~75 % | Moyenne |
| Crypto-algo | ~70 % | Haute (hard exit, ticks, chart API) |
| Métriques Prometheus | ~25 % | **Critique** |
| API REST / WebSocket | ~85 % | Moyenne |
| Modèle de données | ~90 % | Faible (`AlgoPriceTick` absent) |

**Points bloquants pour un opérateur :**

1. `docs/metrics.md` décrit 24 métriques et leurs points d'instrumentation worker à la majorité **n'existe que comme définition** dans `packages/backend/src/metrics.ts`.
2. Les labels documentés ne correspondent pas toujours au code (`redemption_total`, `snapshot_created_total`, `api_route_duration_ms`).
3. Plusieurs fonctionnalités livrées (market tracking, hard exit crypto-algo, chart API) ne figurent pas dans la doc utilisateur.

---

## 2. Méthodologie

Analyse croisée effectuée le 5 juillet 2026 :

- Lecture de l'ensemble des fichiers `docs/*.md` et `docs/code/*.md`.
- Comparaison avec les points d'entrée runtime : `packages/backend/src/index.ts`, `packages/worker/src/index.ts`, `packages/crypto-algo/src/index.ts`.
- Recherche systématique des appels `.inc()`, `.set()`, `.observe()` et helpers `record*` sur les métriques Prometheus.
- Vérification des entités (`packages/core/src/entities/index.ts`), migrations (`packages/core/src/migrations/`), routes backend et événements Socket.IO.

---

## 3. Métriques Prometheus à écart critique

### 3.1 Architecture réelle

Les métriques sont **définies et exposées uniquement par le backend** (`GET /metrics`, registry `prom-client` dans `packages/backend/src/index.ts`). Le worker **n'importe pas** `prom-client` et n'écrit pas directement dans le registry.

Seul mécanisme worker → backend identifié pour l'observabilité :

```
Worker (move-detector.ts)
  → POST /api/internal/metrics/circuit-breaker  { name, state }
       → recordCircuitBreakerState()  →  polywatch_circuit_breaker_open
```

### 3.2 Matrice métrique par métrique

| Métrique | Type | Labels (code) | Labels (doc) | Instrumentée ? | Source réelle |
|----------|------|---------------|--------------|----------------|---------------|
| `polywatch_positions_open` | Gauge | — | — | **Non** | — |
| `polywatch_positions_open_by_mode` | Gauge | `mode` | `mode` | **Non** | — |
| `polywatch_positions_by_status` | Gauge | `status` | `status` | **Non** | — |
| `polywatch_illiquid_positions` | Gauge | — | — | **Non** | — |
| `polywatch_sl_fired_total` | Counter | — | — | **Non** | — |
| `polywatch_tp_fired_total` | Counter | — | — | **Non** | — |
| `polywatch_trailing_fired_total` | Counter | — | — | **Non** | — |
| `polywatch_pre_close_total` | Counter | `type` | `type` | **Non** | — |
| `polywatch_kill_switch_total` | Counter | — | — | **Non** | — |
| `polywatch_spread_mean` | Gauge | — | — | **Non** | — |
| `polywatch_clob_fetch_duration_ms` | Histogram | — | — | **Non** | — |
| `polywatch_clob_errors_total` | Counter | `endpoint` | `endpoint` | **Non** | — |
| `polywatch_data_api_fetch_duration_ms` | Histogram | — | — | **Non** | — |
| `polywatch_data_api_errors_total` | Counter | — | — | **Non** | — |
| `polywatch_circuit_breaker_open` | Gauge | `name` | `name` | **Oui** | Worker → internal API ; label réel : `PolymarketDataAPI` (doc exemple : `data_api`) |
| `polywatch_ws_reconnect_total` | Counter | `channel` | `channel` | **Non** | — |
| `polywatch_strategy_eval_duration_ms` | Histogram | — | — | **Non** | — |
| `polywatch_strategy_eval_positions` | Gauge | — | — | **Non** | — |
| `polywatch_redemption_total` | Counter | `status`, `mode` | *(aucun)* | **Partiel** | `clob-ops-routes.ts` → **real uniquement** |
| `polywatch_redemption_payoff_total` | Counter | `outcome` | `outcome` | **Partiel** | Idem (real only) |
| `polywatch_snapshot_created_total` | Counter | `source` | *(aucun)* | **Oui** | `simulation.ts`, `auto-snapshot-loop.ts` → `auto` / `manual` / `reset` |
| `polywatch_snapshot_count` | Gauge | — | — | **Quasi jamais** | `recordSnapshotCount(0)` à la suppression totale seulement |
| `polywatch_snapshot_purge_total` | Counter | — | — | **Oui** | `auto-snapshot-loop.ts` |
| `polywatch_api_route_duration_ms` | Histogram | `route` | `method`, `route`, `status` | **Partiel** | `positions.ts`, `simulation.ts` uniquement |

**Bilan :** sur 24 métriques personnalisées, **6 sont partiellement ou totalement alimentées**, **18 ne le sont pas du tout**.

### 3.3 Erreurs factuelles dans `docs/metrics.md`

| Affirmation documentée | Réalité code |
|------------------------|--------------|
| Instrumentation dans `strategy-processing.ts`, `move-detector.ts`, `real-executor.ts`, `websocket-book.ts`, `redemption-handler.ts` | Aucun appel prom-client dans le worker (sauf HTTP circuit-breaker depuis `move-detector.ts`) |
| `redemption_total` / `redemption_payoff_total` alimentés par `redemption-handler.ts` | Rédemption sim non comptée ; compteurs incrémentés dans `packages/backend/src/routes/internal/clob-ops-routes.ts` après redeem on-chain |
| `circuit_breaker_open` instrumenté dans `worker/polymarket/circuit-breaker.ts` | Le breaker appelle un callback HTTP ; la gauge est mise à jour côté backend |
| Alerting sur `polywatch_positions_open == 0` | La gauge n'est jamais mise à jour → alerte inopérante |
| Exemples PromQL sur `sl_fired_total`, `strategy_eval_duration_ms` | Compteurs/histogrammes toujours à zéro |

### 3.4 Recommandations métriques

**Option A → Corriger la doc (court terme)**  
Mettre à jour `docs/metrics.md` : statut → implémenté / partiel / défini seulement →, labels exacts, table d'instrumentation réelle, retirer ou marquer → prévu → les exemples PromQL/alerting non opérationnels.

**Option B → Implémenter l'instrumentation (moyen terme)**  
Réutiliser le pattern existant `POST /api/internal/metrics/*` (ou pub/sub Redis) pour que le worker pousse positions, SL/TP, durées CLOB/Data API, reconnexions WS, etc. vers le registry backend.

**Option C → Hybride (recommandé)**  
Doc immédiate reflétant l'état actuel + plan d'implémentation par priorité (positions/SL/TP > latences API > WS reconnect).

---

## 4. Pipelines et processus worker

### 4.1 Composants absents de `docs/code/04-worker.md`

Présents dans `packages/worker/src/index.ts`, non documentés :

| Composant | Fichier | Rôle |
|-----------|---------|------|
| `MarketPercentPublisher` | `processors/strategy/market-percent-publisher.ts` | Publie les variations % marché au backend sur book update |
| `OpenPositionTracker` | `processors/market-tracking/open-position-tracker.ts` | Index mémoire des positions ouvertes par `assetId` |
| `MarketTickRecorder` | `processors/market-tracking/market-tick-recorder.ts` | Persiste `MarketPositionTick` (throttle book updates) |
| Abonnement Redis `backend-ready` | `index.ts` | Refresh trading context après signal backend (debounce 5 s) |
| `ensureCashIntegrity()` | boot worker | Réconciliation cash simulation depuis le ledger |
| Purge horaire ticks | `index.ts` | `tickService.purgeOlderThan()` → rétention `MARKET_TICK_RETENTION_DAYS` |
| `recoverOrphanMoves()` | boot | Réinjection move-events non traités |
| `backfillClosingStartedAt()` | boot | Backfill colonne legacy `closing_started_at` |

### 4.2 Cadences documentées vs code

| Boucle | Documentation | Code (`packages/worker/src/constants.ts`) |
|--------|---------------|-------------------------------------------|
| `MarketResolutionWatcher` | **30 s** (`architecture.md`, `04-worker.md`, `pipeline-copy-trading.md`) | **`15_000` ms** (`MARKET_RESOLUTION_LOOP_MS`) |
| Move detector | → poll 2 s → fixe | Configurable via `RiskConfig.moveDetectorIntervalMs` (défaut 2 000 ms) → partiellement documenté |
| Book subscription sync | Non mentionné | **10 s** (`BOOK_SUBSCRIPTION_SYNC_MS`) |
| Redemption / closing watchdog | 15 s | **15 s** → aligné |
| Strategy eval | 100 ms | **100 ms** → aligné |

### 4.3 Refactor copy-processor

La logique d'entrée (momentum, signal score, triple-pass VWAP) vit dans `packages/worker/src/processors/copy/copy-entry-pipeline.ts`. La documentation cite encore principalement `copy-processor.ts` → le comportement décrit reste correct, les chemins de fichiers sont obsolètes.

### 4.4 Canal Redis `backend-ready`

Le backend publie `backend-ready` au listen (`packages/backend/src/index.ts`). Worker et crypto-algo appellent `waitForBackendReady()`. Ce canal n'apparaît pas dans le tableau → Communication inter-services → de `docs/architecture.md`.

---

## 5. Module crypto-algo

### 5.1 Fonctionnalités implémentées, documentation absente

| Feature (code) | Documentation |
|----------------|---------------|
| Hard exit / time exit (`cryptoAlgoTimeExit*`, `evaluateTimeExit`, onglet UI → Sortie forcée →) | Absent de `docs/crypto-algo.md` et `docs/code/07-crypto-algo.md` |
| `PriceTickRecorder` + entité `AlgoPriceTick` | Plan `docs/plans/PLAN_LOCAL_PRICE_HISTORY.md` seulement → pas dans doc produit |
| `GET /api/algo/market-chart/:conditionId` | Absent de `docs/api.md` et `docs/architecture.md` |
| `SignalStateRegistry`, `PositionContextCache` | Non documentés dans `07-crypto-algo.md` |
| `POST /api/algo-markets/notify-changed` | Non documenté dans `api.md` ; **sans authentification** (appel worker de confiance) |

### 5.2 Paramètre documenté inexistant

`docs/crypto-algo.md` mentionne `cryptoAlgoMaxPositionSizeUsdc` → **aucune occurrence** dans `packages/core/src/entities/RiskConfig.ts`. Le plafond algo utilise les paramètres de mode existants (`getModeMaxPositionSizeUsdc`).

### 5.3 Aligné

- Auto-track, naive-momentum, pipeline entrée (`algo-entry-pipeline.ts`), runtime status Redis, heartbeat 30 s, re-entry guard, surveillance OHLC → cohérents avec le code.

---

## 6. Modèle de données

| Point | Documentation | Code |
|-------|---------------|------|
| Nombre d'entités | 21 (`docs/code/03-core.md`) | **22** → manque `AlgoPriceTick` |
| `AlgoPriceTick` | Absente de `docs/modele-donnees.md` | `packages/core/src/entities/AlgoPriceTick.ts` + migrations 19→23 |
| Migrations TypeORM | 19 (`03-core.md`) | **24** fichiers dans `packages/core/src/migrations/` |
| `synchronize: true` | `modele-donnees.md` présente comme comportement par défaut | `data-source.ts` : **désactivé en production** sauf `ALLOW_SYNCHRONIZE_PROD` ; schéma via `npm run migrate` |

Entités E2E (`E2eTestRun`, `E2eRunPosition`) : documentées → OK.

---

## 7. API REST et WebSocket

### 7.1 Routes manquantes dans `docs/api.md`

| Route | Fichier | Notes |
|-------|---------|-------|
| `GET /api/algo/market-chart/:conditionId` | `routes/algo-market-chart.ts` | Historique ticks algo + metrics embarquées |
| `POST /api/algo-markets/notify-changed` | `routes/algo-markets.ts` | Sans JWT ni service token |

### 7.2 Route présente dans le code, absente de `docs/architecture.md`

```
app.use('/api/algo/market-chart', jwtLimiter, createAlgoMarketChartRouter(ds));
```

### 7.3 Événements WebSocket non documentés (`docs/api.md`)

Émis par `packages/backend/src/websocket.ts` :

| Événement | Room | Documenté |
|-----------|------|-----------|
| `market_tick` | `positions` | Non |
| `market_pct_update` | `markets` | Non (audit 2026-06-25 seulement) |
| `algo_markets_changed` | `markets` | Non |
| `e2e_run_started` / `e2e_run_finished` | `e2e-runs` | Non |
| `e2e_position` / `e2e_position_update` | `e2e-runs` | Non |
| `e2e_log` | `e2e-runs` | Non |

Rooms à la connexion : doc cite `positions`, `executions`, `alerts` → le code joint aussi **`markets`** et **`e2e-runs`**.

### 7.4 Health check

- Doc : `{ status, timestamp }`
- Code : `{ status, database, timestamp }` → HTTP **503** si PostgreSQL inaccessible

---

## 8. Ce qui est correctement documenté

Les éléments suivants sont alignés avec le code au moment de l'audit :

- Structure monorepo (5 packages) et rôles respectifs
- Files Redis (`move-events`, `order-signals`, `close-signals`, `execution-results`) et pattern `BRPOPLPUSH` / dead-letter / `recoverOrphans`
- Pipeline copy-trading de bout en bout : détection, filtres entrée (tags, bid/ask, momentum, signal score), executor A/B, finalize, retry sorties forcées
- Logique SL/TP/trailing hybride, pre-close, kill switch, usage `lastTradePrice` en illiquide
- Snapshots simulation + boucle auto-snapshot backend (`auto-snapshot-loop.ts`)
- Configuration risk (majorité des champs dans `modele-donnees.md`)
- Crypto-algo : auto-track, stratégie naive-momentum, pipeline entrée partagé, statut runtime Redis

---

## 9. Plan de correction documentaire

### P0 → Métriques (bloquant ops)

- [ ] Réécrire `docs/metrics.md` : statut par métrique, labels exacts, instrumentation réelle
- [ ] Retirer ou qualifier les exemples PromQL/alerting sur métriques non alimentées

### P1 → Pipelines

- [ ] Mettre à jour `docs/code/04-worker.md` : market tracking, `backend-ready`, cadence resolution **15 s**
- [ ] Corriger cadence 30 s → 15 s dans `architecture.md`, `pipeline-copy-trading.md`, `02-pipeline-copy-trading.md`
- [ ] Documenter refactor `processors/copy/` dans pipeline docs

### P1 → Crypto-algo

- [ ] Ajouter hard exit (`cryptoAlgoTimeExit*`) dans `crypto-algo.md` et `07-crypto-algo.md`
- [ ] Documenter `PriceTickRecorder`, `AlgoPriceTick`, route market-chart
- [ ] Supprimer `cryptoAlgoMaxPositionSizeUsdc` de `crypto-algo.md`

### P2 → API / données

- [ ] Compléter `docs/api.md` : routes algo chart, notify-changed, événements WS, rooms
- [ ] Ajouter `AlgoPriceTick` à `modele-donnees.md` et `03-core.md`
- [ ] Corriger comptages (22 entités, 24 migrations) et note `synchronize` prod

### P3 → Sécurité / gouvernance

- [ ] Documenter ou protéger `POST /api/algo-markets/notify-changed` (service token ou réseau interne)

---

## 10. Plan d'implémentation métriques (si Option B)

Priorisation suggérée pour combler l'écart doc/code :

| Priorité | Métriques | Point d'instrumentation proposé |
|----------|-----------|----------------------------------|
| P0 | `sl_fired_total`, `tp_fired_total`, `trailing_fired_total`, `pre_close_total`, `kill_switch_total` | `position-exit-evaluator.ts` → POST internal metrics |
| P0 | `positions_open*`, `illiquid_positions`, `spread_mean`, `strategy_eval_*` | Fin de cycle `strategy-processing.ts` |
| P1 | `clob_fetch_duration_ms`, `clob_errors_total` | `real-executor.ts`, `connection-manager.ts` |
| P1 | `data_api_fetch_duration_ms`, `data_api_errors_total` | `move-detector.ts` / `api-client.ts` |
| P1 | `ws_reconnect_total` | `websocket-book.ts`, `websocket-user.ts` |
| P2 | `redemption_total` (sim) | `redemption-handler.ts` ou finalize sim |
| P2 | `snapshot_count` | Mise à jour après create/purge/list snapshots |
| P2 | `api_route_duration_ms` | Middleware Express global ou extension à toutes les routes |

Pattern existant à réutiliser :

```typescript
// Worker
void postBackendJson('/api/internal/metrics/circuit-breaker', { name, state });

// Backend → étendre watchlist-routes ou router metrics dédié
recordCircuitBreakerState(name, state);
```

---

## 11. Matrice de synthèse

```
Document               Alignement   Action prioritaire
??????????????????????????????????????????????????????
metrics.md             ~25 %        Réécriture complète (P0)
code/04-worker.md      ~75 %        Composants + cadences (P1)
architecture.md        ~90 %        Route chart, backend-ready, 15 s (P1)
pipeline-copy-trading  ~85 %        Cadences + copy/ refactor (P1)
code/07-crypto-algo    ~70 %        Hard exit, ticks, chart (P1)
crypto-algo.md         ~75 %        Paramètre fantôme, hard exit (P1)
api.md                 ~85 %        Routes + WS events (P2)
modele-donnees.md      ~90 %        AlgoPriceTick, synchronize (P2)
code/03-core.md        ~88 %        Entités, migrations (P2)
```

---

## 12. Références

| Fichier | Rôle |
|---------|------|
| `docs/metrics.md` | Référence métriques (principale source d'écart) |
| `packages/backend/src/metrics.ts` | Définitions + helpers `record*` |
| `packages/backend/src/index.ts` | Exposition `/metrics`, routes montées |
| `packages/worker/src/index.ts` | Orchestration pipeline + composants non documentés |
| `packages/worker/src/processors/move-detector.ts` | Seul push métrique worker identifié |
| `packages/crypto-algo/src/index.ts` | PriceTickRecorder, notify-changed |
| `docs/code/README.md` | Index documentation technique (v0.1.0, MAJ 28/06/2026) |

---

## 13. Mises à jour documentaires appliquées (5 juillet 2026)

Corrections effectuées suite à cet audit :

- [x] **`docs/metrics.md`** → réécriture complète (statut par métrique, instrumentation réelle)
- [x] **`docs/code/04-worker.md`** → market tracking, `backend-ready`, cadence 15 s, modules copy/strategy
- [x] **`docs/architecture.md`** → route market-chart, canal `backend-ready`, observabilité métriques
- [x] **`docs/pipeline-copy-trading.md`** → refactor `copy/`, gate MOS, TIME_EXIT, cadence 15 s
- [x] **`docs/code/02-pipeline-copy-trading.md`** → idem
- [x] **`docs/crypto-algo.md`** → hard exit, PriceTickRecorder, suppression paramètre fantôme
- [x] **`docs/code/07-crypto-algo.md`** → hard exit, ticks, registres signal/position
- [x] **`docs/api.md`** → routes chart, notify-changed, WS events/rooms, health check
- [x] **`docs/modele-donnees.md`** → `AlgoPriceTick`, `backend-ready`, note `synchronize`
- [x] **`docs/code/03-core.md`** → 22 entités, 24 migrations, `AlgoPriceTick`

**Reste ouvert (hors doc)** : implémentation instrumentation métriques (plan P0), protection `notify-changed`.

---

## 14. Corrections second passage (6 juillet 2026)

Suite à l'audit approfondi par subagents (second pass), les corrections documentaires suivantes ont été appliquées via le plan de correction [`.hermes/plans/2026-07-06_PLAN_CORRECTION_AUDIT_DOCS.md`](../../.hermes/plans/2026-07-06_PLAN_CORRECTION_AUDIT_DOCS.md) :

| Lot | Périmètre | Corrections | Fichiers modifiés |
|-----|-----------|-------------|-------------------|
| P0 | API — Route fantôme | Suppression de `PATCH /api/internal/executions/:orderSignalId` (absente du code) | `docs/api.md` |
| P1 | API — Routes manquantes | Ajout de 17 routes (6 E2E, 4 analytics sim, 2 watchlist settings, 2 ticks, 3 Polygonscan) + champ `cryptoTags` | `docs/api.md` |
| P2 | Worker — Fichiers non documentés | Ajout de 15 fichiers (connection-manager, sl-close-retry, startup-reconciler, etc.) + nouvelle section "Exécution" | `docs/code/04-worker.md` |
| P3 | Pipeline — Lacunes doc technique | Ajout de 4 filtres (momentum, signal score, proximité SL, minTimeToClose) + correction chemin copy-processor.ts | `docs/pipeline-copy-trading.md`, `docs/code/02-pipeline-copy-trading.md` |
| P4 | Crypto-Algo — Mineures | Cleanup ticks 1h, refresh PositionContextCache 5s | `docs/crypto-algo.md`, `docs/code/07-crypto-algo.md` |

**Build :** `npm run build` → 5/5 packages OK (core, backend, worker, crypto-algo, frontend)
**Tests :** `npm run test` → 100% passed (276 tests)

**Reste ouvert :** implémentation instrumentation métriques (plan P0), protection `notify-changed`.

---

*Audit généré par analyse automatisée de la codebase Polywatch v1.1 — juillet 2026.*
