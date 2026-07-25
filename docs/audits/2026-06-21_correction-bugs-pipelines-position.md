# Correction bugs — pipelines de traitement de position

**Date** : 2026-06-21  
**Version** : Polywatch v0.9  
**Statut** : **Implémenté** (phases 1–3)  
**Référence plan** : `.cursor/plans/correction_bugs_pipelines_a80e5d4d.plan.md`  
**Validation doc Polymarket** : [docs.polymarket.com](https://docs.polymarket.com) (juin 2026)

---

## Synthèse

Audit code-level des cinq pipelines parallèles pour une `CopiedPosition` existante
(détection, copy, exécution, stratégie, rédemption), suivi de corrections
priorisées sur les risques **argent réel** et **perte de capital**.

| Phase | Périmètre | Statut |
|-------|-----------|--------|
| 1 | Critiques (double ordre, fill tardif, réservation, détection, trailing) | ✅ |
| 2 | Élevés (locks finalize, sizing cash, watchdog, kill switch, redemption failed) | ✅ |
| 3 | Robustesse (mos sortie, plafond SELL, partials WS, timeout CLOB) | ✅ |

Tests : `packages/core` 212/212 · `packages/worker` 58/58.

---

## Phase 1 — Critiques

### Double ordre CLOB

- `ExecutionService.claim()` retourne `{ execution, alreadyInFlight }` si une exec
  `placing` / `live_on_clob` existe déjà pour le même `orderSignalId`.
- L'`Executor` ne reposte pas sur le CLOB : il appelle
  `reconcileInFlightToResult()` (`getOrder` / `getTrades`) via
  `execution-reconciler.ts`.
- Doc Polymarket : chaque retry produit une **nouvelle signature** → nouvel ordre ;
  `INVALID_ORDER_DUPLICATED` ne couvre pas les retries avec paramètres différents.

**Fichiers** : `execution.service.ts`, `executor.ts`, `execution-reconciler.ts`

### Fill tardif (ORDER_DELAYED, WS user)

- Réponse CLOB `delayed` → exec reste `placing`, pas `failed` (`parse-fill-response`,
  `real-executor` retourne `null`).
- `finalize()` accepte un fill réel (`mode=real`, `fillQuantity>0`) même si l'exec
  était `failed` (réconciliation tardive).
- WS user : `findReconcilableRealByClobOrderId()` (exec `placing`, `partial`, ou
  `failed` récent avec `clobOrderId`).
- `startup-reconciler` / `loadReconcilableReal()` : réconciliation au boot et
  après reconnexion WS.

**Fichiers** : `execution.service.ts`, `user-channel-handler.ts`,
`startup-reconciler.ts`, `real-executor.ts`

### Réservation atomique

- Comptages positions actives et exposition via le `EntityManager` de la
  transaction (plus de cache `getActiveCount` incohérent).
- Garde `COPY_OPEN` : refus si position active existe déjà sur
  `(watchlistId, conditionId, assetId, mode)`.

**Fichiers** : `reservation.service.ts`

### Détection — pagination & reconcile boot

- Data API : `sizeThreshold=0` ; retour `{ positions, truncated }`.
- Si troncature (offset ≥ 10 000 ou page pleine) : pas de faux `CLOSED` pour
  positions absentes du snapshot (`PollCycleOptions.snapshotTruncated`).
- `firstPollPending` uniquement pour les traders **sans** snapshot existant
  (`markFirstPollPendingForNewTraders`), pas pour tous au boot.

**Fichiers** : `api-client.ts`, `move-detector.ts`, `poll-cycle.service.ts`

### Trailing illiquide

- Persistance de `peakClosurePnlPercent` dans le chemin illiquide
  (`position-branches.ts`).

---

## Phase 2 — Élevés

### Verrous finalize

- `PositionLockRegistry` étendu à `ResultsConsumer` et `UserChannelHandler`
  (même mutex que l'`Executor` par `copiedPositionId`).

### Sizing cash réel

- `fetchAvailableRealCash()` : solde on-chain − réservations actives − BUY en vol
  sans réservation (`real-available-cash.ts`).
- Utilisé par `copy-entry-pipeline` à la place du solde brut.

### Closing watchdog

- Avant `markFailed` : `ExecutionService.failActiveForPosition()` annule les exec
  `placing` / `live_on_clob` / `partial` (`watchdog_cancelled`).

### Autres

- Kill switch : `closingAttemptSeq + 1` sur les signaux de fermeture forcée.
- `loadResolvable` inclut `failed` ; redemption `failed` avec gate `isMarketRedeemable`.
- `markFailed` / `markPendingResolution` : UPDATE conditionnels sur le statut source.
- `CopyProcessor` : `markProcessed` si trader absent de la watchlist.
- PRE_CLOSE illiquide : pas de signal SELL (`position-exit-evaluator.ts`).

---

## Phase 3 — Robustesse

### Min order sortie (`mos`)

- `resolveMinOrderShares()` : `getClobMarketInfo().mos` → fallback
  `book.min_order_size` → `MIN_ORDER_SHARES`.
- Appliqué aux **SELL** (real + sim). Si qty < mos avant clôture totale :
  `revertClose()` — attente résolution / redemption.

**Fichiers** : `min-order-size.ts`, `executor.ts`, `real-executor.ts`

### Plafond fill SELL

- `finalize()` : delta et `exec.fillQuantity` plafonnés à `requestedQty`.
- `parse-fill-response` : tolérance SELL 1 % (vs 20 % BUY).

### Partials WS — priorité order UPDATE

- `shouldPreferOrderUpdateForFill()` : ignore les events `trade` tant que l'exec
  est in-flight ; les partials passent par `size_matched` cumulatif (delta).

### Timeout CLOB

- `CLOB_ORDER_TIMEOUT_MS` = 30 s autour de `createAndPostMarketOrder`.
- Timeout → reste `placing` (réconciliation), pas `failed` immédiat.

### Placing janitor

- **Sim-only** (`loadOrphanPlacingSim`) : les exec réelles `placing` sont
  réconciliées via REST/WS, pas le janitor.
- Orphelin si la position a quitté l’état attendu (`pending` pour BUY, `closing` pour SELL, `pending_resolution` pour REDEMPTION), **ou** BUY sim encore `pending` avec réservation absente / expirée / âgée (> `SIM_BUY_PLACING_STALE_MS` = 60 s).
- Voir aussi [`docs/patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md`](./patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md).

---

## Documentation alignée

| Document | Sections mises à jour |
|----------|----------------------|
| `docs/pipeline-copy-trading.md` | Détection, exécution, finalize, watchdogs, cycle de vie |
| `docs/code/02-pipeline-copy-trading.md` | Détail technique par étape |
| `docs/code/03-core.md` | Services Execution, Reservation, CopiedPosition |
| `docs/code/04-worker.md` | Nouveaux modules CLOB, sizing, watchdogs |

---

## Tests de non-régression ajoutés

| Test | Fichier |
|------|---------|
| Cap SELL `fillQuantity` à `requestedQty` | `execution.service.test.ts` |
| Delta partial order UPDATE | `ws-user-events.test.ts` |
| Priorité order vs trade | `ws-user-events.test.ts` |
| `resolveMinOrderShares` (mos) | `min-order-size.test.ts` |
| Timeout helper | `with-timeout.test.ts` |
| ORDER_DELAYED → type `delayed` | `parse-fill-response.test.ts` |
| Pagination `{ positions, truncated }` | `api-client.test.ts` |
