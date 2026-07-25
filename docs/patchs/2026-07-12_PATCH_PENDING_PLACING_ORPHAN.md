# Patch : pending + placing orphelin (crypto algo sim)

**Date** : 2026-07-12  
**Statut** : **Implémenté**  
**Contexte** : positions algo sim bloquées en `pending @ 0.0000` alors que la file `algo-order-signals` est vide — BUY sim coincé en `placing` sans résultat `execution-results`.

---

## 1. Symptôme

| UI | BDD |
|----|-----|
| `En attente` / `pending @ 0.0000` | `copied_positions.status = pending`, `quantity = 0` |
| « File algo vide » | `algo-order-signals` = 0 (signal déjà consommé) |
| Fermeture vide | `executions.status = placing`, pas de `executed_at` |

Après ~3 min : `cancelled` + `close_reason = reservation_expired`, exec `failed` / `placing_orphan`.

---

## 2. Cause racine

État mort **pending + BUY `placing`** :

1. **Executor** : après `claim`, un abort (timeout lock position) pouvait sortir sans enqueuer de résultat → exec orpheline en `placing`.
2. **PlacingJanitor** : ne traitait un BUY `placing` que si `pos.status !== pending` → ignoré tant que la position restait `pending`.
3. **PendingEntryJanitor** : ne re-enqueue pas si un BUY existe déjà (`hasInFlightBuy`).

Le capital restait gelé jusqu’au TTL réservation (`RESERVATION_TTL_MS` = 180 s).

---

## 3. Correctifs

| Couche | Fichier | Changement |
|--------|---------|------------|
| Prévention | `packages/worker/src/processors/executor.ts` | Bloc post-claim dans `try/catch` : tout throw après `claim` enqueue `position_lock_timeout` sans re-throw ; `resolveExecution` ne retourne plus `null` |
| Prévention | `packages/worker/src/polymarket/ensure-book-ready.ts` | Paramètre `abortSignal` optionnel — sortie anticipée des retries (sleep abortable) |
| Récupération | `packages/core/src/services/execution.service.ts` | `loadOrphanPlacingSim()` : BUY `placing` + `pending` **stale** (`SIM_BUY_PLACING_STALE_MS` = 60 s) |
| Janitor | `packages/worker/src/watchdogs/placing-janitor.ts` | `finalize` failed / `placing_orphan` + `setAlgoEntryCooldown` pour ALGO_OPEN BUY sim |

**Stratégie** : fail-fast (pas de re-enqueue). `finalize(failed)` sur BUY + `pending` annule la position et libère la réservation.

### Suite post-audit (2026-07-13)

| Item | Détail |
|------|--------|
| `helpers/sleep-unless-aborted.ts` | Extrait de l'executor pour usage partagé (`ensureBookReady`, sim latency) |
| Catch post-claim | Ferme le trou throw lock timeout pendant `ensureBookReady` (sans dépendre du janitor) |
| Cooldown janitor | Aligné sur `ResultsConsumer` pour `placing_orphan` ALGO_OPEN BUY |

### Correctif secondaire (post-patch) : garantie post-claim sim

Ajout dans [`packages/worker/src/processors/executor.ts`](packages/worker/src/processors/executor.ts) :

- `claimSucceeded` + `terminalSettled` pour toute exécution sim.
- `settleTerminal(result)` : retry `resultsQueue.enqueue` (3×) puis fallback `completeExecution` en direct si Redis échoue.
- `finally` post-claim : si un résultat terminal n'a pas été posé (abort silencieux, throw sans catch, etc.), force un `failed` local.

Objectif : un BUY sim claimé ne reste plus en `placing` si la file Redis ou le process fait défaut ; le janitor reste filet de sécurité mais n'est plus le seul garde-fou.

---

## 4. Tests

| Suite | Cas |
|-------|-----|
| `executor.test.ts` | Abort post-claim, abort post-`ensureBookReady`, `resolveExecution` → failed |
| `execution.service.test.ts` | `loadOrphanPlacingSim` : réservation fraîche (non orphelin) vs âgée / absente / pos cancelled |

---

## 5. Vérification ops

```powershell
npx tsx tools/_audit-pending-window.ts
npx tsx tools/_audit-queue-placing.ts
```

Critères : 0 position `pending` ALGO_OPEN sim prolongée avec exec `placing` ; annulation en ≤ ~60 s janitor (ou immédiat via executor) au lieu de 180 s TTL.

**Redémarrage worker requis** après déploiement.

---

## 6. Docs alignées

| Document | Section |
|----------|---------|
| `docs/code/04-worker.md` | Watchdogs, invariant executor post-claim |
| `docs/code/03-core.md` | `ExecutionService.loadOrphanPlacingSim`, `SIM_BUY_PLACING_STALE_MS` |
| `docs/pipeline-copy-trading.md` | `PlacingJanitor` |
| `docs/code/02-pipeline-copy-trading.md` | Filets de sécurité |
| `docs/audits/2026-07-12_audit-crypto-algo-file-worker-pending-execution.md` | §2.8 risque résiduel fermé |
