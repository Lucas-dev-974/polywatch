# Plan — Crypto-algo : durcissement exécution & files Redis

**Date :** 2026-07-12  
**Version :** Polywatch v1.1  
**Statut :** Livré (PR1 + PR2 E2E + PR3 Ops/Doc + PR4 reset sim Redis)  
**Contexte :** suite à l’audit [`docs/audits/2026-07-12_audit-crypto-algo-file-worker-pending-execution.md`](../audits/2026-07-12_audit-crypto-algo-file-worker-pending-execution.md)

---

## 1. Objectif

Éviter la récidive du blocage `pending @ 0.0000` / file `algo-order-signals` saturée, sans casser :

- la **reprise** d’ordres orphelins (`resumeEntryFromReservation`, `PendingEntryJanitor`)
- le copy trading (même helper `enqueueEntrySignal`)
- les fills confirmés en régime nominal

---

## 2. Principes corrigés (vs plan initial)

| Sujet | Plan initial (incorrect) | Plan corrigé |
|-------|--------------------------|--------------|
| Phase 4 abstention | Bloquer tout le pipeline si pending | Bloquer seulement **nouvelle réserve** ; garder resume + janitor |
| Clé janitor | Aligner sur `hashAlgoLogicalKey` | **Garder** `janitor:{positionId}` — canal orphelin distinct |
| Critère file | ≤ 1 job / signalId | Ratio jobs/signalIds **< 1.5×** worker down ; max **2 retries** / réserve |
| Worker liveness | Gate enqueue sur heartbeat | **Ne pas** gate tant que `worker:heartbeat` SET n’existe pas |
| Resume tick | Appeler resume à chaque tick | **Noop** si `hasInFlightBuy` ou marqueur dedup encore actif |
| Phase 3 sync | Pub/sub seul | Pub/sub + **mutex** sur `syncBookSubscriptions` |

---

## 3. Phases d’implémentation

### Phase 0 — Bounded retry enqueue (P1) ✅ cible PR1

**Fichiers :**
- `packages/core/src/sizing/entry-enqueue-retry.ts` (constantes)
- `packages/core/src/worker-shared/redis-queue.ts` (`hasDedupeMarker`, `acquireBoundedRetrySlot`)
- `packages/core/src/sizing/enqueue-entry-signal.ts`
- `packages/core/src/sizing/enqueue-entry-signal.test.ts`
- `packages/core/src/sizing/resume-reserved-entry.ts` (passer `hasInFlightBuy`)

**Comportement :**
1. `enqueueUnique` — succès → fin
2. Si `hasInFlightBuy` → skip (worker en cours)
3. Si `hasBuyExecution` → skip
4. `acquireBoundedRetrySlot` (cooldown 45s + max 2 / fenêtre réserve) → sinon skip
5. `enqueue` plain — **une** retry bornée, pas à chaque tick

**Janitor :** conserve `logicalKey: janitor:${positionId}`.

**Critères d’acceptation :**
- Worker down 5 min : ratio jobs/signalIds < 1.5×
- Worker up : orphelin finit par fill ou `close_reason` explicite
- Copy trading : tests `enqueue-entry-signal` verts

---

### Phase 4a — Anti-spam resume tick (P2) ✅ cible PR1

**Fichiers :**
- `packages/crypto-algo/src/processors/algo-entry-pipeline.ts`

**Comportement** (branche `existingReservation` uniquement) :
- Si `hasInFlightBuy` → return `null` (defer worker)
- Si `hasDedupeMarker(logicalKey)` → return `null` (job déjà en file / TTL actif)
- Sinon → `resumeEntryFromReservation` (inchangé)

**Ne pas** ajouter d’abstention globale avant `runAlgoEntryPipeline` — cela couperait la reprise.

---

### Phase 4b — Cooldown post-échec exécution (P2) ✅ cible PR1

**Fichiers :**
- `packages/core/src/redis/algo-entry-cooldown.ts`
- `packages/worker/src/processors/results-consumer.ts`
- `packages/crypto-algo/src/processors/algo-entry-pipeline.ts`
- `packages/crypto-algo/src/index.ts` (passer `redisCmd`)

**Comportement :**
- Sur `ALGO_OPEN` BUY `failed` → SET `algo-entry-cooldown:{conditionId}:{mode}` TTL **30s**
- `runMode` abstient avec raison courte si cooldown actif
- Clé par `conditionId:mode` (pas par position) — court pour ne pas bloquer re-entry légitime longue

---

### Phase 3 — Pub/sub `algo-selections-changed` (P2) ✅ cible PR1

**Fichiers :**
- `packages/core/src/redis/algo-selections-changed.ts`
- `packages/crypto-algo/src/index.ts` (publish après janitor)
- `packages/worker/src/index.ts` (subscribe + debounce 2s)
- `packages/worker/src/polymarket/sync-book-subscriptions.ts` (mutex in-flight)

**Comportement :**
- Publish quand janitor `added > 0 || disabled > 0`
- Worker : `syncBookSubscriptions` debounced, sans chevauchement

---

### Phase 5 — E2E fenêtre 5m (P2) — PR2 ✅

**Fichier :** `e2e/crypto-algo/crypto-algo.execution-hardening.e2e.test.ts`

**Commande :**
```bash
npm run test:e2e:crypto:hardening
```

**Couverture autonome (pg-mem + MockRedis, sans worker/Postgres live) :**
- bounded enqueue / tick spam
- blocage retry si BUY in flight
- clé janitor indépendante
- anti-spam resume pipeline
- cooldown entrée + ResultsConsumer
- pub/sub `algo-selections-changed`
- happy path (1 job / 1 réservation)

---

### Phase Ops — Observabilité (P3) — PR3 ✅

- Endpoint `GET /api/algo/worker-queue-status`
- Badge profondeur file dans UI surveillance
- `flush-redis-queues` : `close_reason = reservation_released`
- Script backfill `close_reason` pour anciens `cancelled`
- `worker:heartbeat` SET EX 60s (miroir crypto-algo)

### Phase Doc (P3) — PR3 ✅

- `docs/crypto-algo.md`
- `docs/modele-donnees.md`
- Mise à jour audit §5 quand phases livrées

---

## 4. Ordre de livraison

```
PR1 (ce chantier) : Phase 0 + 4a + 4b + 3
PR2              : Phase 5 E2E
PR3              : Ops + Doc
```

---

## 5. Validation opérationnelle (continu)

Après chaque PR touchant worker/algo :

```powershell
npx tsx tools/_audit-redis-clients.ts      # ≥ 5 brpoplpush
npx tsx tools/_audit-redis-queues.ts       # algo-order-signals ≈ 0
npx tsx tools/_audit-worker-liveness.ts    # delta file ≈ 0 sur 8s
```

Observer 3–5 fenêtres 5m : fill ou message d'échec explicite, pas de re-gonflement file.

Reset sim : vérifier `redisPurge` dans la réponse API — voir [`plans/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md`](./2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md).

---

## 6. Hors scope immédiat

- Multi-consumer parallèle sur `algo-order-signals`
- Abstention globale `entry_in_flight` avant pipeline
- Fusion clé dedup janitor / marché
- Gate enqueue sur liveness worker (jusqu’à `worker:heartbeat` SET)
