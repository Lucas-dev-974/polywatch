# Plan — Réinitialisation simulation & hygiène Redis

**Date :** 2026-07-12  
**Version :** Polywatch v1.1  
**Statut :** Implémenté (PR4a–c)  
**Contexte :** reset sim nettoie la DB mais pas Redis → `pending` fantôme, blocage dedup, file stale.

---

## 1. Objectif

Garantir qu'une **réinitialisation simulation** laisse un état **cohérent DB + Redis** pour le mode `sim`, sans régresser reprise orpheline, copy sim, ni trading réel.

---

## 2. Diagnostic

| Couche | Reset actuel | Risque |
|--------|--------------|--------|
| PostgreSQL | ✅ sim supprimé | — |
| Redis files | ❌ jobs `mode:sim` restants | Drainage parasite ; `reservation_expired` |
| Marqueurs dedup algo | ❌ TTL ~180 s | Blocage enqueue sim |
| Pipeline | ❌ enqueue `false` après reserve sans release | **`pending` fantôme** |

---

## 3. Principes corrigés (post-audit)

| Sujet | Décision corrigée |
|-------|-------------------|
| Marqueurs dedup algo | **Ne jamais** `SCAN` + wipe global `enqueued:*` — clés hashées, **real serait impacté** |
| Collecte pré-delete | Snapshot DB sim (réservations, pending algo) **avant** transaction reset → clés ciblées |
| Purge listes | **`LREM` par payload** — pas `DEL` + `RPUSH` (race avec producteurs concurrents) |
| Cooldown | `SCAN algo-entry-cooldown:*:sim` — safe (suffixe mode explicite) |
| Phase A + B | **Les deux P0** — A seul évite pending fantôme mais laisse thrashing reserve/release |
| Enqueue `false` | Ordre : `hasInFlightBuy` → defer ; `hasBuyExecution` → release ; `hasDedupeMarker` → defer ; sinon release |

---

## 4. Phases

### Phase A — Pipeline (P0)

**Fichiers :** `entry-enqueue-result.ts`, `algo-entry-pipeline.ts`, `resume-reserved-entry.ts`

### Phase B — Purge Redis ciblée (P0)

**Fichier :** `sim-reset-redis-hygiene.ts`

1. `collectSimRedisPurgeHints(ds)` — **avant** delete DB
2. `purgeSimExecutionRedisState(redis, hints)` — **après** commit :
   - `LREM` jobs `mode===sim` dans files + `:processing`
   - `DEL` marqueurs algo pour `algoLogicalKeys` collectées + `janitor:{id}`
   - `DEL` marqueurs copy `order-signals:enqueued/retry-*` pour `copySignalIds`
   - `SCAN` + `DEL` `algo-entry-cooldown:*:sim`

### Phase C — Reset API (P1)

Purge après commit ; `publishSimulationReset` + `emitSimulationReset`

### Phase D — Pub/sub (P2)

Canal `simulation-reset` — log défensif crypto-algo / worker

### Phase E — E2E (P1) ✅

```bash
npm run test:e2e:crypto:sim-reset
```

### Phase F — Doc (P2) ✅

- `docs/crypto-algo.md`, `docs/snapshots-simulation.md`, `docs/api.md`, `docs/modele-donnees.md`, `docs/frontend.md`
- `tools/flush-redis-queues.ts` (note : reset sim auto vs purge manuelle incident)

---

## 5. Livraison

```
PR4a : Phase A + B
PR4b : Phase C + D
PR4c : Phase E + doc
```

---

## 9. Références

- [`2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md`](./2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md)
- `packages/core/src/idempotence/hash.ts` — logicalKey inclut `mode` (hash opaque)
