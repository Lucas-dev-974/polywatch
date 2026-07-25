# Implémentation — Optimisations latence & pipelines (Phases 0 à 6)

**Date** : 2026-06-20
**Version** : Polywatch v0.8
**Référence** : [plan d'audit](./2026-06-20_plan-optimisation-latence-pipelines.md)
**Statut** : **Implémenté** — phases 0 à 6 livrées, build OK, tests verts (core + worker).

Ce document décrit les changements réellement appliqués au code, par phase, avec
les fichiers touchés, les nouveaux fichiers, les variables d'environnement et les
actions d'exploitation requises.

---

## 0. Résumé exécutif

| Phase | Objet | Statut |
|-------|-------|--------|
| 0 | Corriger 2 bugs fantômes (reconcile config-changed, retry copy) | ✅ |
| 1 | Token-bucket global + gestion 429 worker | ✅ |
| 2 | Index composites + pré-fetch parallèle entry pipeline | ✅ |
| 3 | Suppression sleep 250 ms + pré-souscription books WS | ✅ |
| 4 | Batch `persistCycle` + cache watchlist/risk | ✅ |
| 5 | Détection `/activity` (double-run + filet `/positions`) | ✅ |
| 6 | Refactors séparation des responsabilités | ✅ |

### Actions d'exploitation requises

1. **Migrer la base** (nouvelle table `trader_activity_cursors`, nouveaux index) :
   ```bash
   npm run migrate -w packages/core
   ```
2. **Redémarrer le worker**.
3. (Optionnel) Valider la Phase 5 en `ACTIVITY_SHADOW_MODE=true` avant bascule.

---

## 1. Phase 0 — Corrections de fiabilité

### 0.1 Moves OPENED/INCREASED perdus

- **Avant** : sur `config-changed`, tous les traders étaient remis en
  `markFirstPollPending` → cycle suivant en `reconcile()` qui n'émet pas les
  OPENED/INCREASED, mais persiste quand même le snapshot → move perdu.
- **Après** : le handler `config-changed` n'appelle plus `markFirstPollPending`
  global. Il invalide seulement les caches de config (voir Phase 4).

**Fichiers** : `packages/worker/src/index.ts`.

### 0.2 Retry copy bloqué après réservation partielle

- **Avant** : une position `pending` créée puis échec avant `markProcessed`
  bloquait le retry (`hasActivePosition` incluait `pending`) → move marqué
  processed sans ordre exécuté.
- **Après** :
  - `hasBlockingActivePosition(...)` ne bloque que les `open`/`closing` ou les
    `pending` d'un **autre** `moveEventId` (le même move est *resumable*).
  - `runCopyEntryPipeline` reprend une réservation existante
    (`findByOrderSignalId`) au lieu de re-réserver, et libère la réservation
    (`release`) si l'enqueue échoue après réservation.

**Fichiers** : `packages/worker/src/processors/copy/copy-position-lookup.ts`,
`copy-risk-gate.ts`, `copy-entry-pipeline.ts`,
`packages/core/src/services/reservation.service.ts` (ajout `findByOrderSignalId`).

---

## 2. Phase 1 — Garde-fou débit API

### Nouveaux fichiers
- `packages/worker/src/polymarket/token-bucket.ts` — `TokenBucket` (fenêtre
  glissante) + buckets partagés : `dataApiPositionsBucket` (150/10 s),
  `dataApiGeneralBucket` (1000/10 s), `clobBookBucket` (1500/10 s).
- `packages/worker/src/polymarket/rate-limited-fetch.ts` — `rateLimitedFetch`
  (acquire token → fetch → retry 429 avec `Retry-After` + backoff exponentiel +
  jitter) ; `RateLimitExceededError`.

### Modifications
- `api-client.ts` : tous les `fetch` passent par `rateLimitedFetch` avec le
  bucket adéquat.
- `circuit-breaker.ts` : les erreurs **429 retryables ne comptent plus** comme
  échec du circuit breaker (évite le blackout 30 s sur throttling).

**Tests** : `packages/worker/src/polymarket/circuit-breaker.test.ts`.

---

## 3. Phase 2 — Quick wins latence

### Index composites (entités TypeORM)
- `copied_positions(watchlist_id, condition_id, asset_id, mode, status)`
- `watchlist(trader_address)`
- `executions(mode, executed_at)`

**Fichiers** : `packages/core/src/entities/{CopiedPosition,Watchlist,Execution}.ts`.
Création via `synchronize` au prochain `npm run migrate`.

### Pré-fetch parallèle (entry pipeline)
`fetchRealPusdBalance`, `resolveTraderPortfolioValue` et
`marketService.loadByConditionIds` sont désormais exécutés en `Promise.all`
(les 3 passes VWAP restent séquentielles, car dépendantes).

**Fichier** : `packages/worker/src/processors/copy/copy-entry-pipeline.ts`.

---

## 4. Phase 3 — Latence poll + books WS

### Suppression du sleep 250 ms inter-pages
La pause systématique entre pages `/positions` est supprimée ; la protection est
désormais assurée par le token-bucket de la Phase 1.

**Fichiers** : `api-client.ts`, constante `DATA_API_PAGE_DELAY_MS` retirée de
`packages/worker/src/constants.ts`.

### Pré-souscription des books de moves entrants
- Nouveau registre `packages/worker/src/polymarket/pending-move-assets.ts`
  (`registerPendingMoveAsset` TTL 30 s + `getPendingMoveAssetIds`).
- `syncBookSubscriptions` fusionne les assets des positions actives **et** les
  assets de moves en cours → plus de désabonnement prématuré (sync toutes les
  10 s) avant que la position copiée existe.
- `copy-processor.ts` enregistre l'asset au début du traitement d'entrée.

---

## 5. Phase 4 — DB & cache

### Batch `persistCycle`
- 1 requête unique pour charger les positions copiées ouvertes
  (`loadOpenCopiedPositionKeys`) au lieu de N requêtes `hasOpenCopiedPosition`.
- Upsert des snapshots en lot (`save(snapshotsToSave)`).
- Sémantique `snapshotSeq` préservée (incrément seulement si moves insérés).

**Fichier** : `packages/core/src/services/poll-cycle.service.ts`.

### Cache watchlist / risk (TTL 5 s)
- `WatchlistService.loadAll` / `findByTraderAddress` et `RiskService.getConfig`
  servent depuis un cache mémoire (TTL 5 s).
- Invalidation explicite sur `config-changed` :
  `WatchlistService.invalidateCache()` + `RiskService.invalidateConfigCache()`.
- Le kill switch reste **live** (`checkKillSwitch` lit toujours la requête PnL).

**Fichiers** : `watchlist.service.ts`, `risk.service.ts`, `index.ts`.

---

## 6. Phase 5 — Détection `/activity`

### Nouveaux fichiers
- `packages/core/src/entities/TraderActivityCursor.ts` — curseur persisté par
  trader (`lastActivityTimestamp` + `lastActivityOrderKey`).
- `packages/core/src/polymarket/activity.ts` — type `DataApiActivity`, helpers
  `isTradeActivity`, `isSplitMergeActivity`, `activityOrderKey`.
- `packages/core/src/services/activity-detection.service.ts` —
  `ActivityDetectionService` (mapping événements → transitions →
  `PollCycleService.applyTransitions`), `compareMoveSets`, `moveDetectionSignature`.

### Worker
- `api-client.ts` : `fetchUserActivity` / `fetchRecentUserActivity`
  (rate-limited via `dataApiGeneralBucket`).
- `move-detector.ts` : refonte en **dual-path** :
  - chemin `/activity` toutes les ~2 s (principal) ;
  - chemin `/positions` toutes les **60 s** (filet de sécurité) ;
  - dédoublonnage par `hashMoveEventId` ;
  - métriques de divergence loguées (`activity/positions double-run divergence`).

### Garde-fous (conformes au plan §8.3)
| Garde-fou | État |
|-----------|------|
| `/positions` reconcile périodique (60 s) | ✅ |
| Curseur persisté en DB | ✅ |
| SPLIT/MERGE non mappés → couverts par `/positions` | ✅ |
| Double-run + métriques de divergence | ✅ |
| Filtre DECREASED/CLOSED élargi à `open`/`pending`/`closing` | ✅ |

### Variables d'environnement
| Variable | Défaut | Effet |
|----------|--------|-------|
| `ACTIVITY_DETECTION_ENABLED` | `true` | `false` → legacy positions-only |
| `ACTIVITY_SHADOW_MODE` | `false` | `true` → double-run, `/positions` reste primaire |

**Tests** : `packages/core/src/services/activity-detection.service.test.ts`.

---

## 7. Phase 6 — Refactors

| Refactor | Fichier(s) |
|----------|-----------|
| Branches liquide/illiquide extraites de `evaluatePosition` | `packages/worker/src/processors/strategy/position-branches.ts` (+ `strategy-processing.ts`) |
| Slippage guard partagé sim/réel | `packages/worker/src/execution/slippage-guard.ts` (← `executor.ts`, `clob/real-executor.ts`) |
| Coordinateur refresh (dédup config-changed / backend-ready) | `packages/worker/src/worker-context-refresh.ts` (← `index.ts`) |
| Lookups position consolidés dans `CopiedPositionService` | `packages/core/src/services/copied-position.service.ts`, `relevance.ts`, `copy-position-lookup.ts` |
| `buildStaleTick` délègue à `computePnlSnapshot` | `packages/worker/src/processors/strategy/position-evaluator.ts` |

**Tests** : `packages/worker/src/execution/slippage-guard.test.ts`.

> Note : `OPEN_COPIED_POSITION_EXISTS_SQL` (filtre des moves surfacés) inclut
> désormais `open`/`pending`/`closing` (cohérent avec la détection activity).

---

## 8. Gains attendus (rappel du plan)

| Étape | Avant | Après 0–3 | Après 5 |
|-------|-------|-----------|---------|
| Détection | ~1–2,5 s | ~1–2 s | **< 1 s** |
| Total OPENED → position ouverte | ~1,5–5,5 s | ~1,2–4 s | **~0,8–3 s** |

---

## 9. Fichiers nouveaux (récapitulatif)

```
packages/core/src/entities/TraderActivityCursor.ts
packages/core/src/polymarket/activity.ts
packages/core/src/services/activity-detection.service.ts
packages/core/src/services/activity-detection.service.test.ts
packages/worker/src/polymarket/token-bucket.ts
packages/worker/src/polymarket/rate-limited-fetch.ts
packages/worker/src/polymarket/pending-move-assets.ts
packages/worker/src/polymarket/circuit-breaker.test.ts
packages/worker/src/execution/slippage-guard.ts
packages/worker/src/execution/slippage-guard.test.ts
packages/worker/src/worker-context-refresh.ts
packages/worker/src/processors/strategy/position-branches.ts
```
